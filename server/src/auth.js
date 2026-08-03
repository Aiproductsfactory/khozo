// Authentication & role-based access control.
import jwt from 'jsonwebtoken';
import { findUserById } from './store.js';

const SECRET = process.env.KHOZO_JWT_SECRET || 'khozo-dev-secret-change-me';
const TOKEN_TTL = '7d';

// A known signing secret lets anyone mint a valid super_admin token, so refuse to
// start in production rather than silently accepting the development default.
if (process.env.NODE_ENV === 'production' && !process.env.KHOZO_JWT_SECRET) {
  throw new Error('KHOZO_JWT_SECRET must be set in production. Refusing to start with the development signing secret.');
}

// Role hierarchy from the proposal's access pyramid (higher number = more authority).
export const ROLE_RANK = {
  super_admin: 4, // Govt of India / State Govt / Police Commissioner
  admin: 3, // Asst. Commissioner of Police
  police: 2, // Police Station (user)
  sjpu: 2, // Special Juvenile Police Unit
  ahtu: 2, // Anti Human Trafficking Unit
  cwc: 2, // Child Welfare Committee
  dcpu: 2, // District Child Protection Unit
  rpf: 2, // Railway Protection Force post
  cci: 2, // Child Care Institution
  jjb: 2, // Juvenile Justice Board
  state_nodal: 3, // State child-protection nodal officer
  sara: 3, // State adoption resource agency
  crime_bureau: 3, // State/national crime records bureau
  dcrb: 2, // District crime records bureau
  dlsa: 2, // District legal services authority
  saa: 2, // Specialised adoption agency
  ngo: 1, // NGO
  parent: 1, // Public / parent
};

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: TOKEN_TTL });
}

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

// Express middleware: requires a valid Bearer token, attaches req.user.
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = findUserById(payload.sub);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function passwordChangeRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  if (req.user.mustChangePassword) {
    return res.status(403).json({
      error: 'Password change required before using operational workflows',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
  }
  next();
}

// Restrict a route to one or more roles.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Insufficient permissions for this action' });
    next();
  };
}
