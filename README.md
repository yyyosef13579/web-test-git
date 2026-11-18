# web-test-git

A Node.js backend for a team issue tracker: teams with members and roles,
issues, comments with emoji reactions, a private AI chat per issue (Google
Gemini), and an admin panel with an audit log.

The server lives in [`backend-node/`](backend-node/). It is plain JavaScript
(ES modules) on Express 5 with the official MongoDB driver.

## Requirements

- Node.js 20.19 or newer
- A MongoDB database (local or MongoDB Atlas)
- Optional: a Google Gemini API key for the AI chat

## Getting started

```sh
cd backend-node
cp .env.example .env    # then fill in MONGO_URI (and GEMINI_API_KEY if you want the AI chat)
npm install
npm start               # API at http://localhost:8080/api
```

`npm run dev` does the same but restarts the server when a file changes.
Database indexes are created automatically on startup.

## Configuration

Settings are read from `backend-node/.env` or from the environment
(variables that are already set win over the file).

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MONGO_URI` | yes | — | MongoDB connection string |
| `MONGO_DB` | no | `resolve` | Database name |
| `GEMINI_API_KEY` | no | — | Enables the AI chat; without it the rest of the API still works |
| `COOKIE_SECURE` | no | `true` | Set to `false` for local http development; keep `true` behind https |
| `FRONTEND_ORIGIN` | no | `http://localhost:5173` | The one browser origin allowed to call the API (CORS) |
| `PORT` | no | `8080` | Port to listen on |

Never commit the real `.env` file.

## API

All routes are under `/api`. Sign-in uses a session cookie, so a browser
client must send requests with credentials.

| Area | Routes |
|------|--------|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Profile | `PATCH /me`, `PUT /me/password` |
| Teams | `GET /teams`, `POST /teams`, `PATCH /teams/:team_id`, `DELETE /teams/:team_id` |
| Members | `GET /teams/:team_id/members`, `POST /teams/:team_id/members`, `PATCH /teams/:team_id/members/:user_id`, `DELETE /teams/:team_id/members/:user_id`, `GET /teams/:team_id/users/lookup` |
| Issues | `GET /teams/:team_id/issues`, `POST /teams/:team_id/issues`, `GET`, `PUT`, `DELETE /teams/:team_id/issues/:issue_id` |
| Comments | `GET`, `POST /teams/:team_id/issues/:issue_id/comments`, `DELETE …/comments/:comment_id`, `PUT`, `DELETE …/comments/:comment_id/reaction` |
| AI chat | `GET`, `POST`, `DELETE /teams/:team_id/issues/:issue_id/chat` |
| Admin | `GET /admin/users`, `PATCH /admin/users/:user_id`, `DELETE /admin/users/:user_id`, `GET /admin/teams`, `DELETE /admin/teams/:team_id`, `GET /admin/audit-logs` |

Every team route checks that the caller is a member of that team, and admin
routes require an admin account. Errors are returned as `{"error": "..."}`.

### The first admin

New accounts are never admins. To create the first one, register normally and
then set `is_admin: true` on that user in the `users` collection. After that,
other admins can be promoted from the admin routes.

## Project layout

```
backend-node/src/
  main.js        startup: settings, database, listen
  app.js         the Express app: CORS, routes, error handling
  config.js      reads the settings above
  error.js, validation.js, logging.js
  db/            connection helpers, collection names, indexes
  <feature>/     auth, user, team, issue, comment, chat, admin:
                 handler.js, routes.js and, where needed, model.js / middleware.js
```
