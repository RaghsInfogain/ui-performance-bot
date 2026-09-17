import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

/** @type {Map<string, { userId: string, expiresAt: number }>} */
const sessions = new Map();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

function readUsers() {
  ensureStore();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeUsers(data) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

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
    createdAt: user.createdAt,
  };
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

function getSessionUser(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  const { users } = readUsers();
  const user = users.find((u) => u.id === session.userId);
  return user ? publicUser(user) : null;
}

export function signup({ name, email, password, company }) {
  const trimmedEmail = String(email ?? '').trim().toLowerCase();
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) throw new Error('Name is required');
  if (!trimmedEmail || !trimmedEmail.includes('@')) throw new Error('Valid email is required');
  if (!password || String(password).length < 6) throw new Error('Password must be at least 6 characters');

  const data = readUsers();
  if (data.users.some((u) => u.email === trimmedEmail)) {
    throw new Error('An account with this email already exists');
  }

  const { salt, hash } = hashPassword(String(password));
  const user = {
    id: `user_${Date.now()}`,
    name: trimmedName,
    email: trimmedEmail,
    company: String(company ?? '').trim(),
    salt,
    hash,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  writeUsers(data);
  const token = createSession(user.id);
  return { token, user: publicUser(user) };
}

export function login({ email, password }) {
  const trimmedEmail = String(email ?? '').trim().toLowerCase();
  const data = readUsers();
  const user = data.users.find((u) => u.email === trimmedEmail);
  if (!user || !verifyPassword(String(password ?? ''), user.salt, user.hash)) {
    throw new Error('Invalid email or password');
  }
  const token = createSession(user.id);
  return { token, user: publicUser(user) };
}

export function logout(token) {
  if (token) sessions.delete(token);
  return { ok: true };
}

export function me(token) {
  return getSessionUser(token);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = getSessionUser(token);
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.user = user;
  req.authToken = token;
  next();
}
