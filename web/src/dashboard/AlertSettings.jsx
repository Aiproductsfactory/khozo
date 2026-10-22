// Where an account's alerts go (shared/station-alerts.js), on its card in
// the Network roster: the number its SMS go to, and for a police station
// login, where the station is and the poster codes it put up. A station
// with a location is the desk for sightings near it.
import { useState } from 'react';
import { api } from '../api.js';
import { useT } from '../i18n.jsx';

/** POST /api/dashboard/network/users/:id/alerts: who may change an account's alerts. */
export const ALERT_SETTINGS_ROLES = ['super_admin', 'admin', 'crime_bureau'];
const STATION_ROLES = ['police', 'sjpu'];

/**
 * Latitude and longitude from what an admin pastes: "23.0300, 72.6010", or a
 * Google Maps link ("…/@23.0300,72.6010,17z" or "…?q=23.0300,72.6010").
 */
export function parseLocation(value) {
  const m = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/.exec(String(value || ''));
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

export default function AlertSettings({ account, onSaved }) {
  const t = useT();
  const station = STATION_ROLES.includes(account.role);
  const desk = account.stationDesk && typeof account.stationDesk === 'object' ? account.stationDesk : null;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const start = () => {
    setForm({
      alertPhone: account.alertPhone || '',
      location: desk ? `${desk.lat}, ${desk.lng}` : '',
      posterCodes: (desk?.posterCodes || []).join(', '),
      on: desk ? desk.on !== false : true,
    });
    setErr('');
    setNote('');
    setOpen(true);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const here = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({ ...f, location: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` })),
      () => setErr(t('This device could not give its location.')),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const save = async (e) => {
    e.preventDefault();
    setErr('');
    setNote('');
    const body = { alertPhone: form.alertPhone.trim() };
    if (station) {
      const place = parseLocation(form.location);
      if (form.location.trim() && !place) {
        setErr(t('Paste the station’s location as latitude, longitude, or a Google Maps link.'));
        return;
      }
      body.stationDesk = place ? { ...place, posterCodes: form.posterCodes, on: form.on } : null;
    }
    setBusy(true);
    try {
      const data = await api.post(`/dashboard/network/users/${encodeURIComponent(account.id)}/alerts`, body);
      onSaved?.(data.user);
      const ignored = Array.isArray(data.ignoredCodes) ? data.ignoredCodes : [];
      if (ignored.length) setNote(t('Not poster codes, so left out: {codes}. A code is lowercase letters, numbers and dashes, as printed after ?src= on the poster.', { codes: ignored.join(', ') }));
      else setOpen(false);
    } catch (error) {
      setErr(error.message);
    } finally {
      setBusy(false);
    }
  };

  const devices = Number(account.alertDevices) || 0;
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
      <p>
        {devices ? t('Alerts reach {n} phone(s) with the app.', { n: devices }) : t('No phone has the app signed in.')}
        {' '}
        {account.alertPhone ? t('SMS to {phone}.', { phone: account.alertPhone }) : station && account.phone ? t('SMS to {phone}.', { phone: account.phone }) : t('No SMS number.')}
      </p>
      {station && (
        <p className="mt-0.5">
          {desk
            ? desk.on !== false
              ? t('Station desk: sightings near it come here.')
              : t('Station desk switched off.')
            : t('Not a station desk yet: give the station’s location.')}
          {desk?.posterCodes?.length ? ` ${t('Poster codes: {codes}.', { codes: desk.posterCodes.join(', ') })}` : ''}
        </p>
      )}
      {open && form ? (
        <form onSubmit={save} className="mt-2 grid gap-2">
          <label className="block">
            <span className="label">{t('Alert SMS number (the post’s CUG mobile)')}</span>
            <input className="field w-full py-1.5 text-xs" value={form.alertPhone} onChange={set('alertPhone')} inputMode="tel" maxLength={20} />
          </label>
          {station && (
            <>
              <label className="block">
                <span className="label">{t('Station location')}</span>
                <span className="flex gap-2">
                  <input className="field w-full py-1.5 text-xs" value={form.location} onChange={set('location')} placeholder="23.0300, 72.6010" autoComplete="off" />
                  <button type="button" className="btn-ghost shrink-0 px-2 py-1.5 text-xs" onClick={here}>{t('Here')}</button>
                </span>
                <span className="mt-0.5 block text-[11px] text-gray-500">{t('Latitude, longitude, or a Google Maps link. “Here” uses this device, if you are at the station.')}</span>
              </label>
              <label className="block">
                <span className="label">{t('Poster codes (comma between each)')}</span>
                <input className="field w-full py-1.5 text-xs" value={form.posterCodes} onChange={set('posterCodes')} placeholder="kalupur, kalupur-railway" autoComplete="off" />
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.on} onChange={set('on')} />
                <span>{t('Send sightings near this station here')}</span>
              </label>
            </>
          )}
          {err && <p className="text-red-700">{err}</p>}
          {note && <p className="text-amber-800">{note}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary px-3 py-1.5 text-xs" disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setOpen(false)} disabled={busy}>{t('Cancel')}</button>
          </div>
        </form>
      ) : (
        <button type="button" className="mt-1 font-semibold text-khozo-dark underline" onClick={start}>{t('Set where alerts go')}</button>
      )}
    </div>
  );
}

