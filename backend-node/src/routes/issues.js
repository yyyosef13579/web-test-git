// A team's issues. Each gets a per-team number (#1, #2, ...).
import { Router } from 'express';

import { allow, db, fail, getInTeam, member, newId, notFound, now, oneOf, roleOf, text } from '../helpers.js';

const router = Router();
const issues = '/teams/:team_id/issues';

/** Checks the body of both "create" (status is ignored: new issues are open) and "edit" (the whole issue is sent back). */
function checkInput(input, team) {
  input ??= {};
  const assigneeId = input.assignee_id ?? null;
  const result = {
    title: text('Title', input.title, 200),
    description: text('Description', input.description, 10_000),
    priority: oneOf('Priority', input.priority, ['low', 'high', 'critical']),
    status: input.status == null ? null : oneOf('Status', input.status, ['open', 'closed']),
    assignee_id: assigneeId,
  };
  if (assigneeId !== null && (typeof assigneeId !== 'string' || !roleOf(team, assigneeId))) {
    throw fail(400, 'The assignee must be a team member');
  }
  return result;
}

/** All of the team's issues, oldest first. Filtering and search happen in the frontend. */
router.get(issues, member, async (req, res) => {
  res.json(await db.collection('issues').find({ team_id: req.team._id }).sort({ created_at: 1 }).toArray());
});

router.get(`${issues}/:issue_id`, member, async (req, res) => {
  res.json(await getInTeam(req, 'issues', req.params.issue_id));
});

router.post(issues, member, async (req, res) => {
  const input = checkInput(req.body, req.team);
  // $inc hands out the next number atomically, so two issues created at once can't both become #7.
  const team = await db.collection('teams').findOneAndUpdate({ _id: req.team._id }, { $inc: { issue_counter: 1 } }, { returnDocument: 'after' });
  if (!team) throw notFound();
  const time = now();
  const issue = {
    _id: newId(),
    team_id: team._id,
    number: team.issue_counter,
    title: input.title,
    description: input.description,
    priority: input.priority,
    status: 'open',
    creator_id: req.user._id,
    assignee_id: input.assignee_id,
    created_at: time,
    updated_at: time,
  };
  await db.collection('issues').insertOne(issue);
  res.json(issue);
});

/** Team admins, the creator and the assignee can edit an issue. */
router.put(`${issues}/:issue_id`, member, async (req, res) => {
  const issue = await getInTeam(req, 'issues', req.params.issue_id);
  allow(req, [issue.creator_id, issue.assignee_id]);
  const input = checkInput(req.body, req.team);
  issue.title = input.title;
  issue.description = input.description;
  issue.priority = input.priority;
  issue.status = input.status ?? issue.status;
  issue.assignee_id = input.assignee_id;
  issue.updated_at = now();
  await db.collection('issues').replaceOne({ _id: issue._id, team_id: req.team._id }, issue);
  res.json(issue);
});

/** Team admins and the creator can delete an issue; its comments and chats go with it. */
router.delete(`${issues}/:issue_id`, member, async (req, res) => {
  const issue = await getInTeam(req, 'issues', req.params.issue_id);
  allow(req, [issue.creator_id]);
  const inIssue = { team_id: req.team._id, issue_id: issue._id };
  await db.collection('issues').deleteMany({ _id: issue._id, team_id: req.team._id });
  await db.collection('comments').deleteMany(inIssue);
  await db.collection('chat_messages').deleteMany(inIssue);
  res.status(204).end();
});

export default router;
