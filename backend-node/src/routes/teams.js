// Teams and their members. A team document holds its members: [{ user_id, role }].
import { Router } from 'express';

import {
  allow, auth, db, deleteTeam, email, fail, member, newId, notFound, now,
  oneOf, publicUser, roleOf, teamView, text,
} from '../helpers.js';

const router = Router();
const ROLES = ['admin', 'contributor'];

const save = (team) => db.collection('teams').updateOne({ _id: team._id }, { $set: { name: team.name, members: team.members } });

/** A team must always keep at least one admin. */
function keepsAdmin(team, userId) {
  const admins = team.members.filter((m) => m.role === 'admin').length;
  if (roleOf(team, userId) === 'admin' && admins === 1) throw fail(400, 'A team needs an admin. Make someone else admin first');
}

async function findByEmail(value) {
  const user = await db.collection('users').findOne({ email: email(value) });
  if (!user) throw fail(400, 'No account uses that email');
  return user;
}

/** The user's teams, with the issue counts the dashboard shows. */
router.get('/teams', auth, async (req, res) => {
  const { user } = req;
  const teams = await db.collection('teams').find({ 'members.user_id': user._id }).sort({ name: 1 }).toArray();
  const count = (team, filter) => db.collection('issues').countDocuments({ ...filter, team_id: team._id });
  const summaries = [];
  for (const team of teams) {
    const [open, urgent, mine] = await Promise.all([
      count(team, { status: 'open' }),
      count(team, { status: 'open', priority: { $in: ['high', 'critical'] } }),
      count(team, { status: 'open', assignee_id: user._id }),
    ]);
    summaries.push({
      _id: team._id,
      name: team.name,
      role: roleOf(team, user._id) ?? 'contributor',
      member_count: team.members.length,
      open_issues: open,
      urgent_issues: urgent,
      my_issues: mine,
    });
  }
  res.json(summaries);
});

router.post('/teams', auth, async (req, res) => {
  const team = {
    _id: newId(),
    name: text('Team name', req.body?.name, 60),
    members: [{ user_id: req.user._id, role: 'admin' }], // the creator is the first admin
    issue_counter: 0, // number of the last issue, for #1, #2, ...
    created_at: now(),
  };
  await db.collection('teams').insertOne(team);
  res.json(teamView(team));
});

router.patch('/teams/:team_id', member, async (req, res) => {
  allow(req);
  req.team.name = text('Team name', req.body?.name, 60);
  await save(req.team);
  res.status(204).end();
});

router.delete('/teams/:team_id', member, async (req, res) => {
  allow(req);
  await deleteTeam(req.team, req.user);
  res.status(204).end();
});

router.get('/teams/:team_id/members', member, async (req, res) => {
  const ids = req.team.members.map((m) => m.user_id);
  const users = await db.collection('users').find({ _id: { $in: ids } }).sort({ name: 1 }).toArray();
  res.json(users.map((u) => ({ _id: u._id, name: u.name, email: u.email, role: roleOf(req.team, u._id) ?? 'contributor' })));
});

/** Finds an account by exact email, so an admin can check who they're adding. */
router.get('/teams/:team_id/users/lookup', member, async (req, res) => {
  allow(req);
  res.json(publicUser(await findByEmail(req.query.email)));
});

router.post('/teams/:team_id/members', member, async (req, res) => {
  allow(req);
  const role = oneOf('Role', req.body?.role, ROLES);
  const user = await findByEmail(req.body?.email);
  if (roleOf(req.team, user._id)) throw fail(409, 'Already a member of this team');
  req.team.members.push({ user_id: user._id, role });
  await save(req.team);
  res.status(204).end();
});

router.patch('/teams/:team_id/members/:user_id', member, async (req, res) => {
  allow(req);
  const { user_id: userId } = req.params;
  const role = oneOf('Role', req.body?.role, ROLES);
  if (role !== 'admin') keepsAdmin(req.team, userId);
  const membership = req.team.members.find((m) => m.user_id === userId);
  if (!membership) throw notFound();
  membership.role = role;
  await save(req.team);
  res.status(204).end();
});

/** Admins can remove anyone; everyone can remove themselves (leave the team). */
router.delete('/teams/:team_id/members/:user_id', member, async (req, res) => {
  const { user_id: userId } = req.params;
  if (userId !== req.user._id) allow(req);
  if (!roleOf(req.team, userId)) throw notFound();
  keepsAdmin(req.team, userId);
  req.team.members = req.team.members.filter((m) => m.user_id !== userId);
  await save(req.team);
  // Their issues in this team go back to unassigned.
  await db.collection('issues').updateMany({ team_id: req.team._id, assignee_id: userId }, { $set: { assignee_id: null } });
  res.status(204).end();
});

export default router;
