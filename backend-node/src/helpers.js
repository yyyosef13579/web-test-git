// Shared by all routes: database, errors, input checks, sessions and permissions.
import bcrypt from 'bcrypt';
import { MongoClient, ObjectId } from 'mongodb';
import { createHash, randomBytes } from 'node:crypto';

// ---------- settings (.env) and database ----------

try {
  process.loadEnvFile(); // reads ./.env; variables that are already set win
} catch {
  // no .env file: settings come from the real environment
}

export let db; // set once by connect(), used by every route

export async function connect() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI must be set');
  const client = new MongoClient(process.env.MONGO_URI);
  await client.connect();
  db = client.db(process.env.MONGO_DB ?? 'resolve');
}

export const log = (level, message) => console.log(`[${new Date().toISOString()} ${level}] ${message}`);

// ---------- errors ----------

/** Throw `fail(404, 'Not found')` in a route and the client gets {"error": "Not found"} with status 404. */
export const fail = (status, message) => Object.assign(new Error(message), { httpStatus: status });
export const forbidden = () => fail(403, 'You are not allowed to do that');
export const notFound = () => fail(404, 'Not found');

// ---------- input checks (request bodies are untrusted JSON) ----------

/** Trimmed text of 1 to `max` characters (an emoji counts as one). */
export function text(field, value, max) {
  const t = typeof value === 'string' ? value.trim() : '';
  if (t === '' || [...t].length > max) throw fail(400, `${field} must be 1 to ${max} characters`);
  return t;
}

/** Stored lowercase, so "Bob@x.com" and "bob@x.com" are the same account. */
export function email(value) {
  const e = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!e.includes('@') || e.length > 254) throw fail(400, 'Enter a valid email');
  return e;
}

/** A required string used as is (passwords are never trimmed). */
export function required(field, value) {
  if (typeof value !== 'string') throw fail(400, `${field} is required`);
  return value;
}

export function oneOf(field, value, allowed) {
  if (!allowed.includes(value)) throw fail(400, `${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

// ---------- ids and times ----------

export const newId = () => new ObjectId().toHexString();

let lastTime = 0;
/** Current time as an ISO string. Never returns the same value twice, so sorting by created_at keeps creation order. */
export function now() {
  lastTime = Math.max(Date.now(), lastTime + 1);
  return new Date(lastTime).toISOString();
}

// ---------- users, passwords and sessions ----------

/** A user as the API shows it: everything except the password hash. */
export const publicUser = (u) => ({ _id: u._id, name: u.name, email: u.email, is_admin: u.is_admin === true, created_at: u.created_at });

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) throw fail(400, 'Password must be at least 8 characters');
  return bcrypt.hash(password, 12);
}

export const passwordMatches = (password, user) => bcrypt.compare(password, user.password_hash);

const SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The cookie holds a random token; the database keeps only its SHA-256 hash,
// so a leaked database can't be used to sign in.
export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** httpOnly: page JavaScript can't read it. In production (https, another site) it must be SameSite=None + Secure. */
export function setSessionCookie(res, value, maxAge) {
  const secure = process.env.COOKIE_SECURE !== 'false';
  res.cookie('session', value, { path: '/', httpOnly: true, secure, sameSite: secure ? 'none' : 'lax', maxAge });
}

export async function startSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.collection('sessions').insertOne({ _id: hashToken(token), user_id: userId, expires_at: new Date(Date.now() + SESSION_MS) });
  setSessionCookie(res, token, SESSION_MS);
}

/** The signed-in user who sent this request, or null. */
export async function currentUser(req) {
  const token = req.cookies?.session;
  if (typeof token !== 'string') return null;
  const session = await db.collection('sessions').findOne({ _id: hashToken(token), expires_at: { $gt: new Date() } });
  return session && db.collection('users').findOne({ _id: session.user_id });
}

// ---------- permissions (put one of these before a route) ----------

async function signedIn(req) {
  const user = await currentUser(req);
  if (!user) throw fail(401, 'Please sign in');
  return user;
}

/** Signed-in users only (as req.user). */
export async function auth(req, res, next) {
  req.user = await signedIn(req);
  next();
}

/** System admins only. They manage users and teams but can't open other teams' issues. */
export async function admin(req, res, next) {
  req.user = await signedIn(req);
  if (req.user.is_admin !== true) throw forbidden();
  next();
}

/**
 * Members of the team in the URL only (as req.team and req.role).
 * Non-members get 404, so they can't even learn that the team exists.
 */
export async function member(req, res, next) {
  req.user = await signedIn(req);
  req.team = await db.collection('teams').findOne({ _id: req.params.team_id, 'members.user_id': req.user._id });
  if (!req.team) throw notFound();
  req.role = roleOf(req.team, req.user._id);
  next();
}

/** Team admins may do it, and so may the listed users (like an issue's creator). Everyone else gets 403. */
export function allow(req, userIds = []) {
  if (req.role !== 'admin' && !userIds.includes(req.user._id)) throw forbidden();
}

/** An issue or comment of this team only, or 404. */
export async function getInTeam(req, collection, id) {
  const doc = await db.collection(collection).findOne({ _id: id, team_id: req.team._id });
  if (!doc) throw notFound();
  return doc;
}

// ---------- teams ----------

/** The user's role in the team ("admin" or "contributor"), or undefined if not a member. */
export const roleOf = (team, userId) => team.members.find((m) => m.user_id === userId)?.role;

export const teamView = (t) => ({ _id: t._id, name: t.name, members: t.members, issue_counter: t.issue_counter ?? 0, created_at: t.created_at });

/** Deletes a team with all its issues, comments and chats (team admins and system admins use it). */
export async function deleteTeam(team, actor) {
  for (const name of ['issues', 'comments', 'chat_messages']) {
    await db.collection(name).deleteMany({ team_id: team._id });
  }
  await db.collection('teams').deleteOne({ _id: team._id });
  await audit(actor, 'team.delete', `Team "${team.name}"`);
}

/** Records an admin deleting a user or a team. Name and email are copied so the entry still reads well later. */
export async function audit(actor, action, detail) {
  await db.collection('audit_logs').insertOne({
    _id: newId(),
    actor_id: actor._id,
    actor_name: actor.name,
    actor_email: actor.email,
    action,
    detail,
    created_at: now(),
  });
}
