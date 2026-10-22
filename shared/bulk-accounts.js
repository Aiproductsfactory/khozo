/**
 * Accounts from a spreadsheet: police stations, control rooms, CWCs, NGOs and
 * every other desk, many at a time (POST /api/dashboard/network/users/bulk).
 *
 * A state onboarding fifty police stations would otherwise create fifty
 * accounts one form at a time, then set fifty station locations and alert
 * numbers on top (shared/station-alerts.js). One sheet does both.
 *
 * Nobody is given a password. Each new account gets a one-time activation
 * link, valid for ACTIVATION_DAYS, and its officer sets their own password by
 * opening it (POST /api/auth/activate). So a password never sits in a
 * spreadsheet or a WhatsApp chat, and creating a hundred accounts does not
 * mean hashing a hundred passwords on a Worker allowed 10 ms of CPU. Only a
 * hash of the code is kept, so the stored record cannot be used to activate
 * the account. Uploading the sheet again sends a fresh link to anyone who has
 * not activated yet, and updates the station details of every account.
 */

import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

/** How long an activation link works. */
export const ACTIVATION_DAYS = 7;
/** Rows one request may carry; the console sends a long sheet in parts. */
export const BULK_MAX_ROWS = 100;

const SITE = 'https://khozo.org';

/**
 * The role a sheet names, in the words people use: "Police station",
 * "Control room", "CWC", "NGO". Keys are compared lowercased, with anything
 * that is not a letter or digit removed.
 */
const ROLE_WORDS = {
  police: 'police',
  policestation: 'police',
  station: 'police',
  ps: 'police',
  thana: 'police',
  controlroom: 'police',
  policecontrolroom: 'police',
  sjpu: 'sjpu',
  specialjuvenilepoliceunit: 'sjpu',
  ahtu: 'ahtu',
  antihumantraffickingunit: 'ahtu',
  dcrb: 'dcrb',
  crimerecordsbureau: 'crime_bureau',
  crimebureau: 'crime_bureau',
  scrb: 'crime_bureau',
  dlsa: 'dlsa',
  cwc: 'cwc',
  childwelfarecommittee: 'cwc',
  dcpu: 'dcpu',
  districtchildprotectionunit: 'dcpu',
  rpf: 'rpf',
  rpfpost: 'rpf',
  cci: 'cci',
  childcareinstitution: 'cci',
  saa: 'saa',
  jjb: 'jjb',
  juvenilejusticeboard: 'jjb',
  statenodal: 'state_nodal',
  statenodalofficer: 'state_nodal',
  sara: 'sara',
  admin: 'admin',
  stateadmin: 'admin',
  ngo: 'ngo',
};

/** The role code for what a sheet says, or null. */
export function roleFromSheet(value) {
  const key = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ROLE_WORDS[key] || null;
}

/** Whether a sheet's role means a control room: a police login with no station. */
export function isControlRoomWord(value) {
  return /control\s*room/i.test(String(value ?? ''));
}

export { parseLocation } from './location-text.js';

/** A phone number with spaces and dashes removed, or '' when none was given. */
export function sheetPhone(value) {
  return String(value ?? '').replace(/[\s()-]/g, '');
}

export function isPhone(value) {
  return /^\+?\d{10,15}$/.test(value);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? ''));
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * A new activation: the code to put in the link, and what the account keeps
 * (its hash, when it lapses, who issued it).
 */
export function newActivation(actor, now = Date.now()) {
  // 20 characters an officer can read out over the phone if the link breaks.
  const code = crypto.randomBytes(15).toString('base64url').replace(/[-_]/g, 'x').slice(0, 20);
  return {
    code,
    record: {
      codeHash: sha256(code),
      expiresAt: now + ACTIVATION_DAYS * 86400000,
      issuedAt: now,
      issuedById: actor?.id || null,
      issuedByName: actor?.name || null,
    },
  };
}

/** The link an officer opens to set their password. */
export function activationLink(email, code) {
  return `${SITE}/activate?e=${encodeURIComponent(email)}&c=${encodeURIComponent(code)}`;
}

/** Whether an account still waits for its officer to set a password. */
export function awaitingActivation(user) {
  return Boolean(user) && !user.passwordHash && Boolean(user.activation);
}

/**
 * Whether `code` activates `user` now: 'ok', 'expired', or 'invalid'. The
 * hashes are compared in constant time.
 */
export function checkActivation(user, code, now = Date.now()) {
  const record = user?.activation;
  if (!record?.codeHash || user.passwordHash || typeof code !== 'string' || !code) return 'invalid';
  const given = Buffer.from(sha256(code.trim()), 'hex');
  const kept = Buffer.from(String(record.codeHash), 'hex');
  if (given.length !== kept.length || !crypto.timingSafeEqual(given, kept)) return 'invalid';
  return now > Number(record.expiresAt || 0) ? 'expired' : 'ok';
}
