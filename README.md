# Peblo

**Peblo** is a desktop app (Windows, macOS, Linux) for **notes, tasks, a calendar and an AI assistant** that works on your own notes. People sign up with an email and a password; their data is stored per account in a **PostgreSQL** database (hosted on Supabase).

- **Web app:** https://peblo-stxo.onrender.com (also what the desktop app shows when pointed at a hosted server)
- **Desktop installers:** the [latest release](https://github.com/Tejaskumarno1/peblo-full-stack-developerf/releases/latest) has `Peblo-Setup-<version>.exe` for Windows, a `.dmg` for macOS, and an `.AppImage` and `.deb` for Linux. The app updates itself when a new release is published.

## Features

- **Accounts**: sign up, sign in, change password, sign out of all devices, delete your account and everything in it (Settings → Data).
- **Notes**: block editor with tags, categories, archive, trash, version backups, link previews. Import Notion, Obsidian and Markdown; export Markdown, PDF, Word or HTML.
- **Tasks and calendar**: priorities, deadlines, repeating tasks as one series, month, week and day views.
- **AI**: summaries, action items, tag and title suggestions, a chat grounded in your notes, voice commands and an optional spoken briefing. Notes tagged `#private` and notes in Trash are never shown to any AI. **Settings → AI Providers → Turn off all AI** disables it completely.
- **AI keys**: your own OpenAI or Gemini key (stored encrypted on the server), or a local model through Ollama.
- **Five interface styles**: Studio, Console, Soft Studio, River and Orbit.
- **Share pages and live collaboration**: share a note by link (view or edit), see who is on the page with live cursors, selections and typing hints, comment, react, and follow the presenter.
- **Presenting**: present a note or a PowerPoint deck from a note, with a laser pointer, spotlight, speaker notes and a next-slide preview, while viewers follow along.
- **Files in notes**: PowerPoint, Word, Excel and PDF files shown as frames with previews and a full-screen viewer; pictures keep their size and layout (side by side, beside text, full width) on share pages.
- **Full-screen writing mode** with an outline, a width setting and a Live cursors switch.
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
   PostgreSQL 16 (DATABASE_URL, Supabase in production)

AI: OpenAI, Gemini or local Ollama, using each user's own key
```

Two ways to run:

| Mode | How |
|---|---|
| Desktop (default) | The app starts the server inside itself and connects it to the PostgreSQL database in `DATABASE_URL`. |
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

Requires **Node.js 20+** (22 recommended) and **PostgreSQL 14+** (a free Supabase project works too).

1. Create a database and user:
   ```sql
   CREATE USER peblo WITH PASSWORD 'choose_a_password';
   CREATE DATABASE peblo OWNER peblo;
   ```
   or create a Supabase project and copy its connection string (Connect, Session pooler).
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

`.github/workflows/ci.yml` runs on every push to `main` or `app` and every pull request: type-check, client tests, client build and the smoke test, against a PostgreSQL service. Name branches `PEB-123-short-title` so Jira links them.

## Configuration

All settings are environment variables; see `.env.example` for the full list. The important ones: `DATABASE_URL`, `JWT_SECRET`, `KEY_ENCRYPTION_SECRET`, `ALLOWED_ORIGINS` and `TRUST_PROXY` for hosting, and the rate limits `API_RATE_MAX`, `AI_BURST_MAX`, `AI_DAILY_LIMIT`. An installed app reads `<userData>/.env`.

## Building installers

```bash
npm run dist:win     # Windows installer
npm run dist:mac     # macOS dmg (build on a Mac)
npm run dist:linux   # AppImage and deb (build on Linux)
```

Each OS is built on that OS (Prisma ships a native engine). The GitHub workflow **Build desktop app** does all three; push a tag like `v1.0.4` to publish a release (the Windows, Linux and Mac builds are uploaded to the Releases page, even if one platform fails). Builds are **not code-signed** yet: Windows SmartScreen shows "Windows protected your PC" (More info → Run anyway); on macOS you see "Peblo Not Opened" (Apple cannot check unsigned apps): open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to Peblo, or run `xattr -cr /Applications/Peblo.app` in Terminal once. To remove the warning for everyone, add an Apple Developer ID certificate and set the repo secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; the workflow then signs and notarizes the Mac build.

## Security notes

Passwords are hashed with bcrypt; sessions are JWTs that can be revoked by signing out everywhere. Saved AI keys are encrypted with AES-256-GCM. The server sends strict security headers, rate-limits sign-in, general API use and AI calls, and the Electron window is sandboxed. In desktop mode every install needs the shared database credentials; hosted mode removes that (see `docs/memory/06-issues.md`).

## More documentation

Start with `docs/memory/01-overview.md`. Product documents are in `docs/`; older planning files are kept in `docs/archive/` where marked as out of date.

## Email (confirm address)
Peblo sends a confirmation link when someone signs up or changes email. Set on the server: `SMTP_HOST`, `SMTP_PORT` (465), `SMTP_USER`, `SMTP_PASS` (for Gmail use an App Password) or `RESEND_API_KEY`; optionally `MAIL_FROM` and `PUBLIC_URL`. Without these the app says email sending is not set up and changes apply immediately.
