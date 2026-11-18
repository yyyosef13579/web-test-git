// Comments on an issue. Reactions live inside their comment: reactions: [{ user_id, emoji }].
import { Router } from 'express';

import { allow, db, fail, getInTeam, member, newId, now, text } from '../helpers.js';

const router = Router();
const comments = '/teams/:team_id/issues/:issue_id/comments';

router.get(comments, member, async (req, res) => {
  const filter = { team_id: req.team._id, issue_id: req.params.issue_id };
  res.json(await db.collection('comments').find(filter).sort({ created_at: 1 }).toArray());
});

router.post(comments, member, async (req, res) => {
  const issue = await getInTeam(req, 'issues', req.params.issue_id);
  if (issue.status === 'closed') throw fail(409, 'This issue is closed');
  const comment = {
    _id: newId(),
    team_id: issue.team_id,
    issue_id: issue._id,
    author_id: req.user._id,
    body: text('Comment', req.body?.body, 2_000),
    reactions: [],
    created_at: now(),
  };
  await db.collection('comments').insertOne(comment);
  res.json(comment);
});

/** The author or a team admin can delete a comment. */
router.delete(`${comments}/:comment_id`, member, async (req, res) => {
  const comment = await getInTeam(req, 'comments', req.params.comment_id);
  allow(req, [comment.author_id]);
  await db.collection('comments').deleteMany({ _id: comment._id, team_id: req.team._id });
  res.status(204).end();
});

/** Sets (emoji) or removes (null) the user's one reaction on a comment and returns the comment. */
async function setReaction(req, res, emoji) {
  const comment = await getInTeam(req, 'comments', req.params.comment_id);
  comment.reactions = comment.reactions.filter((r) => r.user_id !== req.user._id);
  if (emoji) comment.reactions.push({ user_id: req.user._id, emoji });
  await db.collection('comments').replaceOne({ _id: comment._id, team_id: req.team._id }, comment);
  res.json(comment);
}

router.put(`${comments}/:comment_id/reaction`, member, (req, res) => setReaction(req, res, text('Emoji', req.body?.emoji, 8)));
router.delete(`${comments}/:comment_id/reaction`, member, (req, res) => setReaction(req, res, null));

export default router;
