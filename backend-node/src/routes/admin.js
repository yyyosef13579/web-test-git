// The system admin panel: all users, all teams and the audit log.
import { Router } from 'express';

import { admin, audit, db, deleteTeam, fail, notFound, publicUser, teamView } from '../helpers.js';

const router = Router();

router.get('/admin/users', admin, async (req, res) => {
  const users = await db.collection('users').find({}).sort({ name: 1 }).toArray();
  res.json(users.map(publicUser));
});

router.patch('/admin/users/:user_id', admin, async (req, res) => {
  const isAdmin = req.body?.is_admin;
  if (typeof isAdmin !== 'boolean') throw fail(400, 'is_admin must be true or false');
  // Stops the last admin from locking everyone out of the panel.
  if (req.params.user_id === req.user._id) throw fail(400, "You can't change your own admin status");
  await db.collection('users').updateOne({ _id: req.params.user_id }, { $set: { is_admin: isAdmin } });
  res.status(204).end();
});

/** Deletes an account. Their comments stay (shown as "Former member"); sessions, chats, memberships and assignments go. */
router.delete('/admin/users/:user_id', admin, async (req, res) => {
  if (req.params.user_id === req.user._id) throw fail(400, "You can't delete your own account here");
  const user = await db.collection('users').findOne({ _id: req.params.user_id });
  if (!user) throw notFound();
  await db.collection('users').deleteOne({ _id: user._id });
  await db.collection('sessions').deleteMany({ user_id: user._id });
  await db.collection('chat_messages').deleteMany({ user_id: user._id });
  await db.collection('teams').updateMany({ 'members.user_id': user._id }, { $pull: { members: { user_id: user._id } } });
  await db.collection('issues').updateMany({ assignee_id: user._id }, { $set: { assignee_id: null } });
  await audit(req.user, 'user.delete', `${user.name} (${user.email})`);
  res.status(204).end();
});

router.get('/admin/teams', admin, async (req, res) => {
  const teams = await db.collection('teams').find({}).sort({ name: 1 }).toArray();
  res.json(teams.map(teamView));
});

router.delete('/admin/teams/:team_id', admin, async (req, res) => {
  const team = await db.collection('teams').findOne({ _id: req.params.team_id });
  if (!team) throw notFound();
  await deleteTeam(team, req.user);
  res.status(204).end();
});

/** The 500 most recent user and team deletions. */
router.get('/admin/audit-logs', admin, async (req, res) => {
  res.json(await db.collection('audit_logs').find({}).sort({ created_at: -1 }).limit(500).toArray());
});

export default router;
