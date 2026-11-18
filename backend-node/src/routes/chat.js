// Each user's private AI chat (Google Gemini) about one issue. Other members can't see it.
// A message: { _id, team_id, issue_id, user_id, role: "user" | "model", text, created_at }.
import { Router } from 'express';

import { db, fail, getInTeam, log, member, newId, now, text } from '../helpers.js';

const router = Router();
const chat = '/teams/:team_id/issues/:issue_id/chat';

// Pinned on purpose: "-latest" aliases silently change quota and behaviour.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
const aiUnavailable = () => fail(503, 'The AI assistant is unavailable right now, try again soon');
const capitalize = (word) => word[0].toUpperCase() + word.slice(1);

/** Sends the conversation to Gemini and returns its reply. The AI only sees this one issue's text. */
async function askGemini(issue, history, message) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw aiUnavailable();
  const instructions =
    'You help a software team with one bug-tracker issue. Only discuss this issue and ' +
    'software debugging; politely decline anything unrelated. Be concise and use Markdown.\n\n' +
    `Issue #${issue.number}: ${issue.title}\n` +
    `Priority: ${capitalize(issue.priority)}\n` +
    `Status: ${capitalize(issue.status)}\n` +
    `Description:\n${issue.description}`;
  const contents = [...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: message }] }];
  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: instructions }] }, contents }),
    });
    if (!response.ok) throw new Error(`Gemini answered ${response.status}: ${await response.text().catch(() => '')}`);
    const reply = (await response.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof reply !== 'string') throw new Error('Gemini sent no text');
    return reply;
  } catch (error) {
    log('ERROR', `Gemini request failed: ${error.message}`);
    throw aiUnavailable();
  }
}

const myChat = (req, issueId) => ({ team_id: req.team._id, issue_id: issueId, user_id: req.user._id });

router.get(chat, member, async (req, res) => {
  res.json(await db.collection('chat_messages').find(myChat(req, req.params.issue_id)).sort({ created_at: 1 }).toArray());
});

/** Starts over: deletes the user's conversation about this issue. */
router.delete(chat, member, async (req, res) => {
  const issue = await getInTeam(req, 'issues', req.params.issue_id);
  await db.collection('chat_messages').deleteMany(myChat(req, issue._id));
  res.status(204).end();
});

/** Sends a message and returns [the user's message, the AI's reply]. */
router.post(chat, member, async (req, res) => {
  const message = text('Message', req.body?.message, 2_000);
  const issue = await getInTeam(req, 'issues', req.params.issue_id);
  const history = await db.collection('chat_messages').find(myChat(req, issue._id)).sort({ created_at: 1 }).toArray();
  const reply = await askGemini(issue, history.slice(-20), message); // the last 20 messages keep requests small

  // Both are saved only after the AI answered, so a failed request leaves no half exchange behind.
  const saved = [
    ['user', message],
    ['model', reply],
  ].map(([role, t]) => ({ _id: newId(), team_id: issue.team_id, issue_id: issue._id, user_id: req.user._id, role, text: t, created_at: now() }));
  await db.collection('chat_messages').insertMany(saved);
  res.json(saved);
});

export default router;
