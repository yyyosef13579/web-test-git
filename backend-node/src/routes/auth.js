// Register, sign in and out, and the signed-in user's own profile.
import { Router } from 'express';

import {
  auth, currentUser, db, email, fail, hashPassword, hashToken, newId, now,
  passwordMatches, publicUser, required, setSessionCookie, startSession, text,
} from '../helpers.js';

const router = Router();

router.post('/auth/register', async (req, res) => {
  const input = req.body ?? {};
  const user = {
    _id: newId(),
    name: text('Name', input.name, 80),
    email: email(input.email),
    password_hash: await hashPassword(input.password),
    is_admin: false, // the first admin is set by hand in the database
    created_at: now(),
  };
  await db.collection('users').insertOne(user); // a taken email fails the unique index → 409
  await startSession(res, user._id);
  res.json(publicUser(user));
});

router.post('/auth/login', async (req, res) => {
  const input = req.body ?? {};
  const e = email(input.email);
  const password = required('Password', input.password);
  const user = await db.collection('users').findOne({ email: e });
  // Same message for an unknown email and a wrong password, so nobody can find out who has an account.
  if (!user || !(await passwordMatches(password, user))) throw fail(400, 'Wrong email or password');
  await startSession(res, user._id);
  res.json(publicUser(user));
});

router.post('/auth/logout', async (req, res) => {
  const token = req.cookies?.session;
  if (typeof token === 'string') await db.collection('sessions').deleteOne({ _id: hashToken(token) });
  setSessionCookie(res, '', 0); // expires the cookie
  res.status(204).end();
});

/** The signed-in user, or null when signed out. */
router.get('/auth/me', async (req, res) => {
  const user = await currentUser(req);
  res.json(user ? publicUser(user) : null);
});

async function checkPassword(password, user) {
  if (!(await passwordMatches(password, user))) throw fail(400, 'Current password is incorrect');
}

router.patch('/me', auth, async (req, res) => {
  const { user } = req;
  const input = req.body ?? {};
  const newEmail = email(input.email);
  // Changing the sign-in email needs the password, so someone with only an open session can't take over the account.
  if (newEmail !== user.email) await checkPassword(required('Current password', input.current_password ?? ''), user);
  user.name = text('Name', input.name, 80);
  user.email = newEmail;
  await db.collection('users').replaceOne({ _id: user._id }, user);
  res.json(publicUser(user));
});

router.put('/me/password', auth, async (req, res) => {
  const { user } = req;
  const input = req.body ?? {};
  await checkPassword(required('Current password', input.current_password), user);
  user.password_hash = await hashPassword(input.new_password);
  await db.collection('users').replaceOne({ _id: user._id }, user);
  // Sign out every device, then sign this one back in.
  await db.collection('sessions').deleteMany({ user_id: user._id });
  await startSession(res, user._id);
  res.status(204).end();
});

export default router;
