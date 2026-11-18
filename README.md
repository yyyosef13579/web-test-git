# web-test-git

A team issue tracker with a Node.js backend and a React frontend: teams with
members and roles, issues, comments with emoji reactions, a private AI chat per
issue (Google Gemini), and an admin panel with an audit log.

The server lives in [`backend-node/`](backend-node/). It is plain JavaScript
(ES modules) on Express 5 with the official MongoDB driver.

The web client lives in [`frontend/`](frontend/). It is React 19 with Vite and
Tailwind CSS.

## Requirements

- Node.js 20.19 or newer
- A MongoDB database (local or MongoDB Atlas)
- Optional: a Google Gemini API key for the AI chat

## Getting started

```sh
cd backend-node
cp .env.example .env    # then fill in MONGO_URI (and GEMINI_API_KEY if you want the AI chat)
npm install
npm run dev             # API at http://localhost:8080/api
```

`npm run dev` restarts the server whenever a file changes. Use `npm start`
for a plain run without watching (for example in production).
Database indexes are created automatically on startup.

In a second terminal, start the frontend:

```sh
cd frontend
cp .env.example .env    # VITE_API_URL=http://localhost:8080/api
npm install
npm run dev             # app at http://localhost:5173
```

`npm run build` writes a production build to `frontend/dist/`.

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
  server.js      startup: database indexes, Express, CORS, error handling, listen
  helpers.js     shared code: settings, database, errors, input checks,
                 sessions and the auth / admin / member permission checks
  routes/        one file per area, each route written in one place:
    auth.js      register, login, logout, me, profile and password
    teams.js     teams and members
    issues.js, comments.js, chat.js (with the Gemini call), admin.js
```
