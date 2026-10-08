# Running Peblo as a hosted server

Peblo can run as a normal web service: one Node process serves the web app and the API, backed by a MySQL database. The desktop app can then be a window onto that server.

## What you need
- A MySQL 8 database (any host) and its connection string.
- A host that runs Node 20+ (Render, Railway, Fly.io, a VPS…).
- The code in this repo.

## Environment variables
| Variable | Notes |
|---|---|
| `DATABASE_URL` | `mysql://user:password@host:3306/peblo` |
| `JWT_SECRET` | **Required in production**, 16+ random characters. The server refuses to start without it. |
| `KEY_ENCRYPTION_SECRET` | Optional; encrypts saved AI keys. Falls back to `JWT_SECRET`. |
| `NODE_ENV` | `production` (also makes the server listen on `0.0.0.0` and serve the web app) |
| `PORT` | Most hosts set this for you |
| `TRUST_PROXY` | `1` when behind the host's proxy, so rate limits see real client addresses |
| `ALLOWED_ORIGINS` | Only if the web client is served from a different address |
| `GEMINI_API_KEYS` / `OPENAI_API_KEY` | Optional shared fallback keys. **Everyone on the server would share them**, so leave them unset on a public server and let users add their own. |

## Steps
1. `npm install` and `npm run install:all`
2. `npm run build` (builds the web app and compiles the server)
3. `npm run serve`

Database tables are created and updated automatically on start.

## Desktop app pointing at the server
Set `PEBLO_API_URL=https://your-server` before starting the app, or put the address in a file named `server-url.txt` in the app's data folder. The app then skips its own local server.

## Not included yet
- No email: **password reset and email verification do not exist**. Change password works while signed in; anyone who forgets it needs to be reset directly in the database.
- Local AI (Ollama) means the machine the *server* runs on. On a public server, turn it off or restrict who can set a custom Ollama address.
- Chat history lives in each browser, not on the server.
