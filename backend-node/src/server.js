// Starts the API: connects to MongoDB, sets up Express and listens.
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { connect, db, fail, log, notFound } from './helpers.js';
import admin from './routes/admin.js';
import auth from './routes/auth.js';
import chat from './routes/chat.js';
import comments from './routes/comments.js';
import issues from './routes/issues.js';
import teams from './routes/teams.js';

await connect();

// Creating an index that already exists does nothing.
const indexes = [
  ['users', { email: 1 }, { unique: true }],
  ['sessions', { expires_at: 1 }, { expireAfterSeconds: 0 }], // MongoDB deletes expired sessions by itself
  ['teams', { 'members.user_id': 1 }, {}],
  ['issues', { team_id: 1, number: 1 }, { unique: true }],
  ['comments', { team_id: 1, issue_id: 1 }, {}],
  ['chat_messages', { team_id: 1, issue_id: 1, user_id: 1 }, {}],
];
for (const [name, keys, options] of indexes) await db.collection(name).createIndex(keys, options);

const app = express();
app.disable('x-powered-by');
app.disable('etag');

// Logs every request: "GET /api/teams → 200 (45ms)".
app.use((req, res, next) => {
  const start = performance.now();
  const path = req.path;
  res.on('finish', () => log('INFO', `${req.method} ${path} → ${res.statusCode} (${Math.round(performance.now() - start)}ms)`));
  next();
});

// The frontend runs on another origin and must send the session cookie.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

app.use('/api', auth, teams, issues, comments, chat, admin);

// Unknown URLs and every error get the same {"error": "..."} shape.
app.use((req, res, next) => next(notFound()));
app.use((error, req, res, next) => {
  if (error?.code === 11000) error = fail(409, 'That email is already in use'); // unique index: email is the only one a user types
  else if (error?.type?.startsWith?.('entity.')) error = fail(400, error.message); // body isn't valid JSON or is too large
  else if (!error?.httpStatus) {
    log('ERROR', error?.stack ?? String(error)); // never the user's fault
    error = fail(500, 'Something went wrong');
  }
  res.status(error.httpStatus).json({ error: error.message });
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, '0.0.0.0', () => log('INFO', `API listening on http://localhost:${port}/api`));
