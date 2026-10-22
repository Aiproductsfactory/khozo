// Reading an accounts sheet (dashboard/BulkAccounts.jsx): which column is
// which, from the headers people write, and each row as the object the server
// takes (POST /api/dashboard/network/users/bulk, shared/bulk-accounts.js).
import { rowTexts } from './prepare.js';

/** Rows the server takes at a time (BULK_MAX_ROWS is 100). */
export const CHUNK = 50;
export const MAX_ROWS = 1000;

/** The sheet's columns, the headers people write for them, and the template's header. */
export const COLUMNS = [
  { key: 'name', header: 'Name', aliases: ['name', 'officer name', 'desk name', 'account name', 'name of officer'] },
  { key: 'role', header: 'Role', aliases: ['role', 'type', 'desk', 'desk type', 'account type'] },
  { key: 'email', header: 'Email', aliases: ['email', 'e-mail', 'email id', 'official email', 'mail'] },
  { key: 'phone', header: 'Mobile', aliases: ['mobile', 'phone', 'mobile no', 'mobile number', 'contact', 'contact number'] },
  { key: 'state', header: 'State', aliases: ['state'] },
  { key: 'district', header: 'District', aliases: ['district', 'city', 'commissionerate'] },
  { key: 'station', header: 'Police station', aliases: ['police station', 'station', 'ps', 'thana', 'station name'] },
  { key: 'location', header: 'Station location', aliases: ['station location', 'location', 'google maps link', 'maps link', 'map link', 'lat long', 'latlong', 'coordinates'] },
  { key: 'lat', header: null, aliases: ['latitude', 'lat'] },
  { key: 'lng', header: null, aliases: ['longitude', 'long', 'lng', 'lon'] },
  { key: 'alertPhone', header: 'Alert SMS number (CUG)', aliases: ['alert sms number cug', 'alert sms number', 'alert number', 'cug', 'cug mobile', 'cug number', 'sms number'] },
  { key: 'posterCodes', header: 'Poster codes', aliases: ['poster codes', 'poster code', 'qr codes', 'qr code'] },
  { key: 'org', header: 'Organisation', aliases: ['organisation', 'organization', 'org', 'office'] },
  { key: 'ngoRegistration', header: 'NGO registration no.', aliases: ['ngo registration no', 'ngo registration number', 'ngo registration', 'registration no', 'registration number'] },
  { key: 'ngoDarpanId', header: 'NGO Darpan ID', aliases: ['ngo darpan id', 'darpan id', 'darpan'] },
];

// Compared with spaces and punctuation gone: "E-mail ID", "Email Id" and "email id" are one header.
const headerKey = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const ALIAS = new Map(COLUMNS.flatMap((c) => c.aliases.map((a) => [headerKey(a), c.key])));

/** The rows of a sheet as objects, keyed by the columns above, with their sheet row number. */
export function sheetRows(sheet) {
  let headerRow = 0;
  let keys = [];
  for (let r = 1; r <= Math.min(10, sheet.maxRow); r++) {
    const found = rowTexts(sheet, r).map((h) => ALIAS.get(headerKey(h)) || null);
    if (found.filter(Boolean).length >= 2) {
      headerRow = r;
      keys = found;
      break;
    }
  }
  if (!headerRow) return { error: 'header' };
  const rows = [];
  for (let r = headerRow + 1; r <= sheet.maxRow && rows.length < MAX_ROWS; r++) {
    const texts = rowTexts(sheet, r);
    if (!texts.some(Boolean)) continue;
    const row = { index: r };
    keys.forEach((key, col) => {
      if (key && texts[col] && !row[key]) row[key] = texts[col];
    });
    // Latitude and longitude in columns of their own.
    if (!row.location && row.lat && row.lng) row.location = `${row.lat}, ${row.lng}`;
    delete row.lat;
    delete row.lng;
    rows.push(row);
  }
  return { rows, headerRow };
}

