# Peblo

**Peblo** is a desktop app (Windows, macOS, Linux) for **notes, tasks, a calendar and an AI assistant** that works on your own notes. People sign up with an email and a password; their data is stored per account in a **MySQL** database.

## Features

- **Accounts**: sign up, sign in, change password, sign out of all devices, delete your account and everything in it (Settings → Data).
- **Notes**: block editor with tags, categories, archive, trash, version backups, link previews. Import Notion, Obsidian and Markdown; export Markdown, PDF, Word or HTML.
- **Tasks and calendar**: priorities, deadlines, repeating tasks as one series, month, week and day views.
- **AI**: summaries, action items, tag and title suggestions, a chat grounded in your notes, voice commands and an optional spoken briefing. Notes tagged `#private` and notes in Trash are never shown to any AI. **Settings → AI Providers → Turn off all AI** disables it completely.
- **AI keys**: your own OpenAI or Gemini key (stored encrypted on the server), or a local model through Ollama.
- **Five interface styles**: Studio, Console, Soft Studio, River and Orbit.
- **Quick capture** from anywhere with `Ctrl/Cmd + Shift + Space`; command palette with `Ctrl/Cmd + K`.

## Architecture

```
Electron main process (electron/main.cjs)
  window (sandboxed React app), tray, quick-capture shortcut
  Express server (server/src, built to dist/server), on 127.0.0.1:<random port>
    /api/auth /profile /notes /todos /dashboard /ai /ai/hub /study /river /import /export
    Socket.IO: per-user live refresh
        |
      Prisma 6
        |
   MySQL 8 (DATABASE_URL)

AI: OpenAI, Gemini or local Ollama, using each user's own key
```

Two ways to run:

| Mode | How |
|---|---|
| Desktop (default) | The app starts the server inside itself and connects it to the MySQL database in `DATABASE_URL`. |
| Hosted | `npm run serve` on a server. Desktop apps point at it with `PEBLO_API_URL` (or `<userData>/server-url.txt`) and start no local server. See `docs/DEPLOYMENT.md`. |

Folders:

```
electron/        Electron main process
server/src/      Express API (TypeScript)
server/prisma/   schema.prisma and hand-written SQL migrations (sql/NNN_name.sql)
client/          React 19 + Vite UI
scripts/         build, smoke test, canvas check, seed scripts
e2e/             Playwright browser tests
docs/memory/     detailed, code-checked notes and the issue register
.github/         CI (type-check, build, tests), dependency audit, installer builds
```

## Set up for development

Requires **Node.js 20+** and **MySQL 8**.

1. Create a database and user:
   ```sql
   CREATE DATABASE peblo CHARACTER SET utf8mb4;
   CREATE USER 'peblo'@'localhost' IDENTIFIED BY 'choose_a_password';
   GRANT ALL ON peblo.* TO 'peblo'@'localhost';
   ```
2. Install: `npm run install:all`
3. Configure: copy `.env.example` to `server/.env` and set `DATABASE_URL` and `JWT_SECRET`.
4. Run: `npm run dev` (API with tsx watch, Vite on 5173, and the Electron window). Tables are created on first start from `server/prisma/sql`.

Other commands:

| Command | What it does |
|---|---|
| `npm run typecheck` | Type-check the server (`tsc --noEmit`) |
| `npm test` | Builds the server and runs the API smoke test against the database in `server/.env`, using throwaway accounts |
| `npm --prefix client test` | Client unit tests |
| `npm run build` | Builds client and server |
| `npm run check:canvas` | Layout check of the fixed 1440 px canvas (after `npm run build`) |
| `npm run seed -- you@example.com` | Fills an account with demo data. It **wipes that account's data first**. |
| `node e2e/<name>.mjs` | One Playwright browser test (see `e2e/README.md`) |

Use a separate database (for example `peblo_test`) for tests, not your real one.

### Changing the database

Edit `server/prisma/schema.prisma`, run `npx prisma generate --schema server/prisma/schema.prisma`, and add the next numbered SQL file in `server/prisma/sql/` with the `ALTER TABLE` statements. The server applies new files on start. Do not regenerate `001` with `npm run db:sql`.

### Continuous integration

`.github/workflows/ci.yml` runs on every push to `app` and every pull request: type-check, client tests, client build and the smoke test, against a MySQL service. Name branches `PEB-123-short-title` so Jira links them.

## Configuration

All settings are environment variables; see `.env.example` for the full list. The important ones: `DATABASE_URL`, `JWT_SECRET`, `KEY_ENCRYPTION_SECRET`, `ALLOWED_ORIGINS` and `TRUST_PROXY` for hosting, and the rate limits `API_RATE_MAX`, `AI_BURST_MAX`, `AI_DAILY_LIMIT`. An installed app reads `<userData>/.env`.

## Building installers

```bash
npm run dist:win     # Windows installer
npm run dist:mac     # macOS dmg (build on a Mac)
npm run dist:linux   # AppImage and deb (build on Linux)
```

Each OS is built on that OS (Prisma ships a native engine). The GitHub workflow **Build desktop app** does all three; push a tag like `v1.0.0` to publish a release. Builds are **not code-signed** yet: Windows SmartScreen shows "Windows protected your PC" (More info → Run anyway); on macOS right-click the app and choose Open the first time.

## Security notes

Passwords are hashed with bcrypt; sessions are JWTs that can be revoked by signing out everywhere. Saved AI keys are encrypted with AES-256-GCM. The server sends strict security headers, rate-limits sign-in, general API use and AI calls, and the Electron window is sandboxed. In desktop mode every install needs the shared database credentials; hosted mode removes that (see `docs/memory/06-issues.md`).

## More documentation

Start with `docs/memory/01-overview.md`. Product documents are in `docs/`; older planning files are kept in `docs/archive/` where marked as out of date.

## Email (confirm address)
Peblo sends a confirmation link when someone signs up or changes email. Set on the server: `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASS` (for Gmail use an App Password) or `RESEND_API_KEY`; optionally `MAIL_FROM` and `PUBLIC_URL`. Without these the app says email sending is not set up and changes apply immediately.
