# 01 · Peblo at a glance

Last verified against the code: 8 Oct 2026, branch `app`, commit `8b0a99b`.

## What Peblo is

Peblo is a desktop app (Windows, macOS, Linux) for **notes, tasks, a calendar and an AI assistant** that works on your own notes. People sign up with an email and password. Their data is stored in a MySQL database.

The app can run in two ways:

| Mode | How it works | When it is used |
|---|---|---|
| **Desktop (default)** | Electron starts the Express server inside the app on `127.0.0.1:<random port>`. That server connects to the MySQL database named in `DATABASE_URL`, and the window loads the React app from it. | Today's installers |
| **Hosted** | The server runs on a host (`npm run serve`). The desktop app is pointed at it with `PEBLO_API_URL` or `<userData>/server-url.txt`, and then no local server starts. A browser can also use it. | Planned for production (see PEB-29) |

> Watch out: in desktop mode every install needs the credentials of the *shared* database, so anyone who has the app's `.env` can read every user's data directly. Moving everyone to hosted mode fixes this. See the issue register (`06-issues.md`, S-01).

## Architecture

```
┌──────────── Electron main process (electron/main.cjs) ────────────┐
│ window (sandboxed, 1440×900 design canvas scaled to fit)            │
│ tray · global shortcut Ctrl/Cmd+Shift+Space → quick-capture window  │
│                                                                     │
│   Express server (server/src, compiled to dist/server)              │
│     /api/auth /api/profile /api/notes /api/todos /api/dashboard     │
│     /api/ai /api/ai/hub /api/study /api/river /api/import|export    │
│     Socket.IO (per-user room: todos_changed, notes_changed)         │
│     serves client/dist (React SPA)                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Prisma 6
                         MySQL 8 database (shared, multi-user)
                               │
        AI providers: OpenAI gpt-4o-mini · Gemini 2.5 Flash · local Ollama
```

## Code map

| Area | Folder / file | Memory file |
|---|---|---|
| Desktop shell | `electron/main.cjs` | 05-platform §1 |
| Server entry, routes | `server/src/index.ts`, `server/src/routes/*` | 02-server §1–2 |
| Business logic | `server/src/controllers/*` | 02-server §4–6 |
| AI | `server/src/services/aiService.ts`, `retrieval.ts` | 02-server §7 |
| Import/export | `server/src/services/importService.ts`, `routes/transfer.ts` | 02-server §4 |
| Security | `middleware/auth.ts`, `rateLimit.ts`, `secrets.ts`, `services/profile.ts` | 02-server §3 |
| Database | `server/prisma/schema.prisma`, `server/prisma/sql/NNN_*.sql`, `server/src/db.ts` | 05-platform §4 |
| Client boot, API, auth | `client/src/main.jsx`, `App.jsx`, `api/*`, `context/AuthContext.jsx` | 03-client §1–3 |
| Studio and Console screens | `client/src/pages/*`, `client/src/components/*` | 03-client §5 |
| Soft, River, Orbit screens | `client/src/soft`, `river`, `orbit` | 04-ui-styles |
| Scripts | `scripts/*` (seed, smoke test, canvas check, demo server, build) | 05-platform §5 |
| Product docs | `docs/00…06` (vision, PRD, TRD, MCP, AI Hub, design, GTM) | 05-platform §6 |

## Features that exist today

- **Accounts:** sign up, sign in, change password, sign out of all devices. Passwords use bcrypt; sessions are 30-day JWTs that carry a token version.
- **Notes:** a block editor (BlockNote, stored as Markdown) with autosave every 1.5 s, tags, categories, archive, trash and restore, keyword search, AI version backups with a diff viewer, link previews, and export to Markdown, PDF, Word, HTML or plain text.
- **Import/export:** Markdown, text, CSV and zip files (Notion and Obsidian exports) in; the whole library as a Markdown zip out.
- **Tasks:** priority, deadline, start/end times, tags, a link to a note, and repeats (made as up to 30 copies). Typed text is turned into tasks by `parseTask.js` (dates, `!priority`, `#tag`).
- **Calendar:** month, week and day views, drag to reschedule, inline add.
- **Home:** daily briefing, weekly report, activity heatmap and streak, top tags, AI usage.
- **AI on notes:** summary, action items, title and tag suggestions, and selection commands (summarise, improve, to-do list, anything typed).
- **AI chat that writes notes:** it can create notes or append to or replace one (a backup is made first). Smart intake turns a pasted text or uploaded PDF into a note plus tasks.
- **AI Hub:** chat grounded in your notes over SSE, with numbered sources. Retrieval is keyword-based, and notes tagged `#private` are excluded. Model routing can be Local only, Ask first, or Auto.
- **Connections:** OpenAI and Gemini keys (encrypted on the server) and Ollama settings. The MCP and Connect cards say "Coming next".
- **AI voice call:** a spoken morning briefing and calls for tasks due soon. Spoken commands can complete, reschedule or create tasks and create or read notes.
- **Five UI styles:** Studio (default), Console, Soft Studio, River (timeline, meeting briefs, promises found in notes) and Orbit (topic map, quizzes, mastery). The style is saved per device.
- **Desktop shell:** tray, quick-capture window, single instance, fixed-canvas scaling with zoom locked, links opened in the external browser.
- **Live refresh:** Socket.IO pushes `todos_changed` and `notes_changed` to the user's other windows.

## How to run it

| Goal | Command |
|---|---|
| Install | `npm run install:all` (also runs `prisma generate`) |
| Configure | Copy `.env.example` to `server/.env` and set `DATABASE_URL` (MySQL 8) and `JWT_SECRET`. A packaged app reads `<userData>/.env`. |
| Develop | `npm run dev` (API on 3001 with tsx watch, Vite on 5173, Electron) |
| Sample data | `npm run seed -- you@example.com`. This **wipes** that account's data first; the password is `password123`. |
| API smoke test | `npm run build:client && npm test` (about 60 checks; uses throwaway accounts in the database named by `server/.env`) |
| Layout check | `npm run build && npm run check:canvas` |
| Installers | `npm run dist` (or `dist:win`, `dist:mac`, `dist:linux`); CI does this on `v*` tags |
| Hosted server | `npm run build && NODE_ENV=production npm run serve` (see `docs/DEPLOYMENT.md`) |

Migrations: add a new `server/prisma/sql/NNN_name.sql` file (the next number) **and** update `schema.prisma`. Do not regenerate `001` with `npm run db:sql`.

## Tech stack

- **Server:** Node 20+, Express 4, Prisma 6 (MySQL), Socket.IO 4, Zod 4, OpenAI SDK 6, `@google/generative-ai` (deprecated SDK), multer, pdf-parse, adm-zip, bcryptjs, jsonwebtoken. The build is per-file esbuild with **no type-check**.
- **Client:** React 19, React Router 7, TanStack Query 5, Zustand, BlockNote 0.51 with Mantine, framer-motion, axios, socket.io-client, marked, diff, html2pdf.js.
- **Desktop:** Electron 44, electron-builder 26 (NSIS, dmg for x64 and arm64, AppImage, deb). No code signing and no auto-update.
