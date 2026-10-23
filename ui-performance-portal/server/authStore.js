import crypto from 'crypto';
import { query } from './db/pool.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const next = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(next, 'hex'));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    company: user.company ?? '',
    createdAt: user.created_at instanceof Date ? user.created_at.toISOString() : user.createdAt,
  };
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)`,
    [token, userId, expiresAt],
  );
  return token;
}

async function getSessionUser(token) {
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.company, u.created_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token],
  );
  if (!rows[0]) return null;
  return publicUser(rows[0]);
}

export async function signup({ name, email, password, company }) {
  const trimmedEmail = String(email ?? '').trim().toLowerCase();
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) throw new Error('Name is required');
  if (!trimmedEmail || !trimmedEmail.includes('@')) throw new Error('Valid email is required');
  if (!password || String(password).length < 6) throw new Error('Password must be at least 6 characters');

  const existing = await query('SELECT id FROM users WHERE email = $1', [trimmedEmail]);
  if (existing.rows.length) throw new Error('An account with this email already exists');

  const { salt, hash } = hashPassword(String(password));
  const id = `user_${Date.now()}`;
  const { rows } = await query(
    `INSERT INTO users (id, name, email, company, salt, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, email, company, created_at`,
    [id, trimmedName, trimmedEmail, String(company ?? '').trim(), salt, hash],
  );
  const token = await createSession(id);
  return { token, user: publicUser(rows[0]) };
}

export async function login({ email, password }) {
  const trimmedEmail = String(email ?? '').trim().toLowerCase();
  const { rows } = await query(
    `SELECT id, name, email, company, salt, password_hash, created_at FROM users WHERE email = $1`,
    [trimmedEmail],
  );
  const user = rows[0];
  if (!user || !verifyPassword(String(password ?? ''), user.salt, user.password_hash)) {
    throw new Error('Invalid email or password');
  }
  const token = await createSession(user.id);
  return { token, user: publicUser(user) };
}

export async function logout(token) {
  if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
  return { ok: true };
}

export async function me(token) {
  return getSessionUser(token);
}

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    const user = await getSessionUser(token);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.user = user;
    req.authToken = token;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
