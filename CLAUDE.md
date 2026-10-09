# Peblo · project memory index

Peblo is an Electron desktop app (also runnable as a hosted web server) for notes, tasks, a calendar and an AI assistant over your own notes. Stack: React 19 + Vite client, Express + Prisma 6 + MySQL 8 server, Socket.IO, OpenAI / Gemini / Ollama.

**Full memory: [`docs/memory/`](docs/memory/README.md).** Read `01-overview.md` first, then the file for the area you are touching. Known problems and their Jira keys (project PEB) are in `06-issues.md`; which of them were proved by running the code is in `08-verification.md`.

**Branch:** work on `app`. GitHub's default branch `main` is the obsolete May web app (PEB-100).

## Where things are
- `electron/main.cjs`: desktop shell. It starts the server in-process on 127.0.0.1 at a random port, unless `PEBLO_API_URL` or `<userData>/server-url.txt` selects hosted mode.
- `server/src/index.ts`: routes are mounted in this order: `/api/auth`, `/api/profile`, `/api/ai/hub`, `/api/notes` (notes, then the AI router mounted a second time), `/api/ai` (AI router, then aiChat), `/api/dashboard`, `/api/todos`, `/api/study`, `/api/river`, `/api` (import/export).
- `server/src/services/aiService.ts`: every AI prompt and the provider cascade. `retrieval.ts` does keyword retrieval for the AI Hub.
- `server/prisma/schema.prisma` and `server/prisma/sql/NNN_*.sql`: migrations are applied at start-up by `server/src/db.ts`.
- `client/src/App.jsx`: routes, picked by UI style. `client/src/pages/*` holds the Studio and Console screens; `client/src/{soft,river,orbit}` hold the other three styles.

## Rules
- Every query must be scoped by `userId: req.user.id`. Never trust ids from the client without that scope.
- New database change: add the next `server/prisma/sql/NNN_name.sql` **and** update `schema.prisma`. Never regenerate `001` (`npm run db:sql` overwrites it).
- New write path for notes or tasks: emit `notes_changed` / `todos_changed` to `req.app.get('io').to(userId)`.
- TanStack Query v5: call `invalidateQueries({ queryKey: [...] })`, never pass a bare array.
- AI output rendered as HTML must be sanitised. Notes tagged `#private` and notes in Trash must never be sent to an AI.
- Dates: the server currently uses its own time zone (bug PEB-74). Do not add more code that assumes the server's "today".
- Validation: use Zod schemas in `server/src/schemas`. Zod 4 errors are in `error.issues`.
- The UI is a fixed 1440×900 canvas, scaled. Don't add responsive breakpoints to desktop screens.
- Never commit `.env` files or secrets. The history already leaked one (PEB-55).
- When you change behaviour, update `docs/memory/` in the same change.

## Commands
`npm run install:all` · `npm run dev` · `npm run seed -- you@example.com` (wipes that account's data) · `npm run build:client && npm test` (smoke test against the DB in `server/.env`) · `npm run check:canvas` · `npm run dist`.
