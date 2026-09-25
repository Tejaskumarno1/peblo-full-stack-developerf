# Peblo

**Peblo** is an AI-powered productivity app for **Windows, macOS and Linux**. It includes notes, to-dos, a calendar and a dashboard, plus an AI assistant that can summarize, pull out tasks and organize messy notes.

There are no accounts and no sign-in. Everything is stored on your computer, in a local database.

---

## Features

- **Notes workspace**: a block editor with tags, categories, archive, trash and version history. Export notes as Markdown, PDF, Word or HTML.
- **To-dos and calendar**: priorities, deadlines, repeating tasks and links back to notes. There are month and day views.
- **Dashboard**: daily briefing, weekly report, activity heatmap and writing streak.
- **AI assistant**: context-aware chat, slash commands (`/summarize`, `/actions`, `/rewrite`, `/fix`), Smart Intake (paste a braindump and get organized notes and tasks back), and voice commands.
- **Command palette**: `Ctrl + K` (or `Cmd + K` on Mac).

### AI keys

AI features need your own API key from **OpenAI** or **Google Gemini**. Add it in **Settings → AI Providers**. The key is saved in the local database and is only sent to that provider when you use an AI feature. Everything else works fully offline.

### Where your data lives

Everything is kept in `peblo.db` inside the app's data folder. Open it from the menu with **Help → Open Data Folder**. To back up, copy that file.

| OS      | Data folder                                   |
|---------|-----------------------------------------------|
| Windows | `%APPDATA%\Peblo`                             |
| macOS   | `~/Library/Application Support/Peblo`         |
| Linux   | `~/.config/Peblo`                             |

---

## Tech stack

- **App shell**: Electron (Chromium and Node.js in one app)
- **UI**: React 19, Vite, React Router, TanStack Query, BlockNote editor
- **Backend**: Express, which runs inside the app on a random `127.0.0.1` port and is never exposed to the network
- **Database**: SQLite through Prisma; schema changes ship as SQL files in `server/prisma/sql/`
- **AI**: OpenAI with Google Gemini as fallback, using the user's own keys

```
electron/main.cjs        Electron main process: starts the API, opens the window
server/src/              Express API (TypeScript)
server/prisma/           Prisma schema + SQL migrations
client/                  React UI (Vite)
scripts/                 Build + smoke-test scripts
.github/workflows/       CI that builds installers for all three OSes
```

---

## Development

Requires **Node.js 20+**.

```bash
npm run install:all      # root (app + server) and client dependencies
npm run dev              # API (tsx) + Vite + Electron window with hot reload
```

In dev mode the database is `peblo-dev.db` in the project folder. To have AI working without the Settings screen, you can copy `.env.example` to `server/.env` and add a key there.

Other commands:

```bash
npm test                 # builds the server and runs the API smoke test on a throwaway database
npm start                # builds everything and opens the production app locally
```

> **npm 11+ note:** newer npm versions block install scripts by default. If Prisma, Electron or esbuild complain after `npm install`, run
> `npm approve-scripts @prisma/client @prisma/engines prisma electron esbuild electron-winstaller` and then `npm rebuild`.

### Changing the database schema

1. Edit `server/prisma/schema.prisma`.
2. Run `npx prisma generate --schema server/prisma/schema.prisma`.
3. Add a new SQL file with the next number, e.g. `server/prisma/sql/002_add_something.sql`. Write the `ALTER TABLE …` statements by hand, or generate them with `prisma migrate diff`.

On launch the app applies any SQL files newer than the database's `PRAGMA user_version`, so existing users keep their data.

---

## Building installers

```bash
npm run dist:win         # release/Peblo Setup x.y.z.exe
npm run dist:mac         # release/Peblo-x.y.z.dmg (Intel + Apple Silicon); must run on a Mac
npm run dist:linux       # release/Peblo-x.y.z.AppImage and .deb; must run on Linux
```

Each OS has to be built on that OS, because Prisma's database engine is a native file. The GitHub Actions workflow **Build desktop app** handles this for you. Run it from the Actions tab and download the installers from the run, or push a tag like `v1.0.0` to publish them as a GitHub Release.

The builds are **not code-signed**. Windows SmartScreen shows "Windows protected your PC" (click *More info → Run anyway*). On macOS, right-click the app and choose *Open* the first time.
