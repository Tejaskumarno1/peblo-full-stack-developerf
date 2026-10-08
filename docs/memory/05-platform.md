# Peblo: platform reverse-engineering report (shell, build, config, DB, tooling, docs)

Repo: `the repo` (git repo, branch `app`, 79 commits, clean tree; other branches `main`, `desktop-app`; remotes `origin`, `pc`).
Nothing in the repo was modified. `node_modules`, `server/generated`, `dist`, `client/dist` are absent, so nothing was built or run.

Architecture in one paragraph: Electron main process (`electron/main.cjs`) imports the compiled Express server (`dist/server/index.js`) **in-process**, starts it on `127.0.0.1:<random port>`, and loads the React SPA (Vite build in `client/dist`, served by that same Express app) into a sandboxed BrowserWindow. Data lives in a **shared MySQL 8 database** (Prisma 6, `DATABASE_URL`), multi-user with JWT accounts. The same server can also run standalone as a hosted web service (`npm run serve`), and the desktop app can be pointed at that remote server instead (`PEBLO_API_URL` / `server-url.txt`). There is **no preload script, no IPC, no auto-update**.

---

## 1. Desktop shell (Electron) behaviour, step by step from launch

File: `electron/main.cjs` (398 lines). `package.json:12` `"main": "electron/main.cjs"`.

### 1.1 Module load (before `app.whenReady`)
1. `isDev = !app.isPackaged` (`main.cjs:10`); `DEV_URL = process.env.PEBLO_DEV_URL` (`:11`, set by `npm run dev:app` to `http://localhost:5173`).
2. If `PEBLO_DATA_DIR` is set, `app.setPath('userData', …)` (`:14`) - used by the canvas check to run on a throwaway profile. Done before the lock, so the lock is per data dir.
3. Single-instance lock (`:17-20`): a second launch quits immediately; the first instance gets `second-instance` and calls `showMainWindow()` (`:357`).
4. Constants: `CAPTURE_SHORTCUT = 'CommandOrControl+Shift+Space'` (`:40`); design canvas `CANVAS = 1440×900` (`:49`); quick-capture canvases per UI style: soft 760×400, river 640×200, orbit 640×220, other 620×256 (`:50-55`); `ICON_PATH = build/icon.png` (`:90`).
5. If `PEBLO_CANVAS_CHECK` is set, `require('../scripts/canvas-check.cjs')` is wired in (`:398`).

### 1.2 `app.whenReady()` (`:361-390`)
1. **Mode selection** (`:364-365`):
   - Dev (`PEBLO_DEV_URL` set): no embedded server - the API is already running via `tsx watch` and the UI via Vite.
   - Remote/hosted: `readRemoteUrl()` (`:29-36`) takes `PEBLO_API_URL`, else the first line of `<userData>/server-url.txt`; trailing slashes stripped; must match `^https?://`. If set, no local server is started.
   - Default: `startBackend()`.
2. **`startBackend()`** (`:165-180`):
   - `mkdir -p userData`.
   - `loadEnvFile()` (`:141-163`): loads the first existing of `PEBLO_ENV_FILE`, `<userData>/.env`, `<appPath>/server/.env` with dotenv (no override of existing env). If `JWT_SECRET` is unset it reads `<userData>/.jwt-secret`, or generates 48 random bytes (96 hex) and writes it with mode 0600. Throws if `DATABASE_URL` is still unset.
   - Sets `PEBLO_SQL_DIR = <appPath>/server/prisma/sql` (rewritten `app.asar` -> `app.asar.unpacked` by `resourcePath`, `:122-125`).
   - Sets `NODE_ENV` = `development` (unpackaged) or `production` (packaged). This matters: in production `middleware/auth.ts:10` refuses to start without a JWT_SECRET of 16+ chars (satisfied by the auto-generated one) and error responses omit stacks.
   - Packaged only: `configurePrismaEngine()` (`:128-133`) finds `query_engine*.node` in the unpacked `server/generated/prisma` and sets `PRISMA_QUERY_ENGINE_LIBRARY`.
   - Dynamic `import()` of `<appPath>/dist/server/index.js` and `startServer({ port: 0, staticDir: <appPath>/client/dist })`. `startServer` (`server/src/index.ts:87-120`) runs `initDatabase()` (SQL migrations, see section 4), `protectExistingKeys()` (encrypts any plaintext API keys and strips them from `users.settings`), builds the Express app, attaches Socket.IO (JWT-authenticated handshake, each socket joins a room named by its userId), and listens on `127.0.0.1:0`. The chosen port is returned.
   - Any failure: `dialog.showErrorBox('Peblo could not start', stack)` and `app.quit()` (`:366-371`).
3. `buildMenu()` (`:324-355`): macOS app menu, File, Edit, View (reload, **toggleDevTools - also in production**, fullscreen), Help (Quick Capture with the accelerator, Open Data Folder -> `shell.openPath(userData)`). The menu bar is auto-hidden (`autoHideMenuBar: true`).
4. `createWindow()` (`:182-235`):
   - Size: 1440×900 content, scaled down to fit the primary display work area (minus 16/56 px), min 720×450, `show:false`, background `#F6F5F2`.
   - `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `spellcheck: true`. No `preload`, so the renderer has no bridge to the main process at all.
   - `lockZoom()` (`:75-89`): swallows Ctrl/Cmd `+ = - _ 0`, resets zoom on `zoom-changed` / `dom-ready` / `did-finish-load`, and sets visual zoom limits to 1 (no pinch).
   - `applyScale()` on resize, maximize, unmaximize, fullscreen enter/leave and move: `zoomFactor = floor(min(w/1440, h/900) * 1000)/1000`, minimum 0.25. Also applied to the capture window. The whole UI is one fixed 1440×900 design canvas, scaled.
   - `loadURL(appUrl('/'))`; base URL priority is `DEV_URL`, then `REMOTE_URL`, then `http://127.0.0.1:<port>` (`:92-95`).
   - `secureWebContents()` (`:107-119`): `window.open` allowed only for `127.0.0.1` / `localhost` (any port); `http(s):` and `mailto:` go to `shell.openExternal`; everything else is denied. `will-navigate` to non-local hosts is blocked and opened externally.
   - Permission handler (`:214-216`): grants only `media` (mic for voice notes / AI voice call), `clipboard-sanitized-write` and `notifications`.
   - Close button: if a tray exists and the app is not quitting, it hides the window and shows a one-time OS notification ("Peblo is still running… Ctrl+Shift+Space…") (`:219-231`).
   - Dev: opens detached DevTools.
5. `screen.on('display-metrics-changed', applyScale)` (`:375`).
6. `createTray()` (`:306-322`), wrapped in try/catch because some Linux desktops have no tray. Icon resized to 16 px (18 on macOS). Menu: Open Peblo, Quick capture, Notes (`/notes`), To-dos (`/todolist`, which the SPA redirects to `/tasks`), Calendar (`/calendar`), Quit. A click on the tray shows the main window.
7. `globalShortcut.register(Ctrl/Cmd+Shift+Space, toggleCapture)`, with a warning if it is taken (`:381-383`).
8. After 3 s, pre-create the hidden quick-capture window (`:385`).
9. macOS `activate`: recreate the window if none exist.

### 1.3 Quick capture window (`:246-304`)
- Frameless, non-resizable, always-on-top, `skipTaskbar`, same sandboxed webPreferences, loads `/quick-capture`.
- `close` is turned into hide (unless quitting); `blur` hides it (unless DevTools is open).
- `toggleCapture()`: reads `localStorage['peblo-style']` from the capture page via `executeJavaScript`, picks the canvas size for that style, sizes the window to `canvas × uiScale`, centres it horizontally on the display under the cursor at 28 % height, then shows and focuses it.
- The renderer shares localStorage (and so the JWT in `peblo-token`) with the main window because both load the same origin.

### 1.4 Quit / lifecycle
- `before-quit` sets `isQuitting` (`:358`); `will-quit` unregisters shortcuts (`:359`).
- `window-all-closed`: quit only on non-macOS **and** when no tray exists (`:392-395`). With a tray the app keeps running in the background.
- No explicit server shutdown or Prisma disconnect; the process exits.

### 1.5 Where data and env live
| Item | Location |
|---|---|
| userData dir | Windows `%APPDATA%\Peblo`, macOS `~/Library/Application Support/Peblo`, Linux `~/.config/Peblo` (overridable with `PEBLO_DATA_DIR`) |
| `.env` (packaged) | `<userData>/.env` or `PEBLO_ENV_FILE` (the `server/.env` candidate sits inside the asar and is not packaged, see bug B1) |
| JWT secret | `<userData>/.jwt-secret` (auto-generated, 0600) when `JWT_SECRET` is unset |
| Remote server URL | `<userData>/server-url.txt` or `PEBLO_API_URL` |
| User data (notes, tasks…) | **Not local.** The MySQL server named by `DATABASE_URL` |
| Per-device UI state | Renderer localStorage: `peblo-token` (JWT, 30 days), `peblo-settings` (settings including **decrypted API keys**), `peblo-theme`, `peblo-style`, `peblo-notifications`, AI Hub chat history (`useHubChat.js`) |

### 1.6 Things the shell does NOT have
- No IPC (`ipcMain` / `ipcRenderer` / `contextBridge` are not used anywhere), no preload.
- No auto-update (`electron-updater` is not a dependency), no crash reporter, no telemetry.
- No CSP (no header in Express, no meta tag in `client/index.html`).
- No Electron fuses and no code signing.
- The API runs in the main process, so heavy work (500 MB AdmZip imports, `pdf-parse`) blocks window management, the tray and the global shortcut (TRD D5).

---

## 2. Build, packaging and CI

### 2.1 Root `package.json` scripts
| Script | Command | What it does |
|---|---|---|
| `postinstall` | `prisma generate --schema server/prisma/schema.prisma` | Generates the Prisma client into `server/generated/prisma` (custom output, so it gets packaged) |
| `install:all` | `npm install && npm --prefix client install` | Root (Electron + server) and client deps |
| `dev` | `concurrently -k … npm:dev:server npm:dev:client npm:dev:app` | Full dev loop |
| `dev:server` | `tsx watch server/src/index.ts` | API on `PORT` or 3001 (direct-run branch of `index.ts:122-138`), needs `server/.env` |
| `dev:client` | `npm --prefix client run dev` | Vite on 5173, which proxies `/api` and `/socket.io` to `localhost:3001` (`client/vite.config.js`) |
| `dev:app` | `wait-on tcp:3001 http-get://localhost:5173 && cross-env PEBLO_DEV_URL=http://localhost:5173 electron .` | Electron pointed at Vite, no embedded server |
| `build:client` | `npm --prefix client run build` | `vite build` -> `client/dist` (manual chunks: vendor, ui, editor, utils, pdf) |
| `build:server` | `node scripts/build-server.mjs` | esbuild transpile of every `server/src/**/*.ts` -> `dist/server` (ESM, node20, sourcemaps, **no bundling, no type-check**) |
| `build` | `build:client && build:server` | |
| `start` | `npm run build && electron .` | Production-mode app from the source tree (`isPackaged=false`, so `NODE_ENV=development`) |
| `dist`, `dist:win`, `dist:mac`, `dist:linux` | `npm run build && electron-builder [--win/--mac/--linux]` | Installers into `release/` |
| `serve` | `node dist/server/index.js` | Hosted mode: `PORT`/3001, `HOST` (0.0.0.0 in production), serves `client/dist` only when `NODE_ENV=production` |
| `db:sql` | `node scripts/make-sql.mjs` | Regenerates `001_init.sql` from the schema (dangerous now, see B6) |
| `seed` | `tsx scripts/seed.ts` | Seeds a test account |
| `test` | `npm run build:server && node scripts/smoke-test.mjs` | API smoke test against the real DB in `server/.env` |
| `check:canvas` | `node scripts/run-canvas-check.mjs` | Electron layout-invariance check |

Client `client/package.json`: `dev` / `build` / `preview` (Vite). Stack: React 19, React Router 7, TanStack Query 5, Zustand, BlockNote 0.51 + Mantine 9, Tailwind 4 (vite plugin dependency), framer-motion, axios, socket.io-client, marked, diff, html2pdf.js, react-window, many @fontsource fonts.

Root runtime deps: `@google/generative-ai` (deprecated SDK), `@prisma/client` 6, `adm-zip`, `bcryptjs`, `cors`, `dotenv`, `express` 4, `jsonwebtoken`, `multer` 2, `openai` 6, `pdf-parse`, `socket.io`, `uuid`, `zod` 4. Dev: electron ^44.4.5, electron-builder ^26.15.3, esbuild ^0.28.2, prisma ^6.2.0, tsx, typescript ^6, concurrently, cross-env, wait-on. `allowScripts` (`package.json:135-142`) pins install-script approval for npm 11.

### 2.2 electron-builder config (`package.json:68-134`)
- `appId: dev.peblo.app`, `productName: Peblo`, output `release/`, buildResources `build/` (only `build/icon.png`, 281 KB).
- `files`: `electron/**`, `build/icon.png`, `dist/server/**`, `server/prisma/sql/**`, `server/generated/prisma/**`, `client/dist/**`, `node_modules/**`, `package.json`; excludes `**/*.map`, `node_modules/.cache`, `electron`, `prisma`, `@prisma/engines`. Note that `scripts/` and `server/.env` are not packaged.
- `asarUnpack`: `server/generated/prisma/**` (native query engine) and `server/prisma/sql/**`.
- No `extraResources`. **No `publish` block** and no `repository` field.
- Windows: NSIS x64, non-one-click, choose install directory, desktop shortcut, artifact `Peblo-${version}-win-x64.exe`.
- macOS: dmg for **x64 and arm64**, category productivity.
- Linux: AppImage + deb, category Office, maintainer "Boddu Tejas Kumar <…>".
- No code signing (CI disables identity auto-discovery), no notarization, no auto-update.

### 2.3 CI: `.github/workflows/build-desktop.yml`
- Triggers: `workflow_dispatch` and tag pushes `v*`.
- Job `build`: matrix of windows-latest, macos-latest and ubuntu-latest (fail-fast off), Node 22, `npm install` + `npm --prefix client install`, `npm run dist` with `CSC_IDENTITY_AUTO_DISCOVERY=false` and `GH_TOKEN`, then uploads `release/*.exe|dmg|AppImage|deb` (error if none).
- Job `release` (tags only): downloads all artifacts and publishes them with `softprops/action-gh-release@v2`.
- Missing: no `npm test`, no `tsc --noEmit`, no lint, no canvas check, no DB service, and no caching.

---

## 3. Configuration: every environment variable

### 3.1 Server / runtime
| Var | Read at | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | `server/prisma/schema.prisma:9`, `server/src/db.ts:10` (throws if missing), `electron/main.cjs:160`, `scripts/smoke-test.mjs:9` | none (required) | MySQL connection string |
| `JWT_SECRET` | `server/src/middleware/auth.ts:9-19`, `secrets.ts:11`, `main.cjs:150-159`, smoke test | dev: `'dev-only-insecure-secret-change-me'` with a warning; prod: must be 16+ chars or the server throws; desktop: auto-generated into `userData/.jwt-secret` | Signs 30-day JWTs `{sub, email, v}` |
| `KEY_ENCRYPTION_SECRET` | `server/src/secrets.ts:11` | falls back to `JWT_SECRET`, then to the dev constant | AES-256-GCM key (sha256 of `peblo-keys:<secret>`) for stored provider API keys (`enc:v1:` prefix) |
| `NODE_ENV` | `index.ts:128` (host and static serving), `errorHandler.ts:18` (stack only in development), `auth.ts:10` | unset; Electron sets it explicitly | production behaviour |
| `PORT` | `index.ts:131` | 3001 | standalone server port |
| `HOST` | `index.ts:132` | `0.0.0.0` in production, else `127.0.0.1` | bind address |
| `PEBLO_STATIC_DIR` | `index.ts:129` | `<cwd>/client/dist` | SPA dir for standalone production |
| `TRUST_PROXY` | `index.ts:40` | unset | Express `trust proxy` (`'true'`, a number or a string) |
| `ALLOWED_ORIGINS` | `index.ts:44` | empty | Extra CORS origins (comma-separated); no-Origin requests and any `localhost`/`127.0.0.1` origin are always allowed |
| `PEBLO_SQL_DIR` | `db.ts:37` | `../prisma/sql` or `../../server/prisma/sql` relative to db.js | Migration folder (set by Electron and the scripts) |
| `SIGNUP_RATE_MAX` | `routes/auth.ts:18` | 10 per hour per IP | Sign-up rate limit (the smoke test raises it to 1000). Login is fixed at 10 per 15 min (`auth.ts:17`) |
| `OPENAI_API_KEY` | `services/aiService.ts:38` | none | Server-wide fallback OpenAI key (shared by all users) |
| `OPENAI_BASE_URL` | read implicitly by the OpenAI SDK; set by the smoke test | api.openai.com | Points OpenAI calls at a fake or compatible server |
| `GEMINI_API_KEYS` / `GEMINI_API_KEY` | `aiService.ts:70` | none | Server-wide fallback Gemini key(s); `GEMINI_API_KEYS` is a list (missing from `.env.example`) |
| `GEMINI_MODEL` | `aiService.ts` (12 call sites) | `gemini-2.5-flash` (`aiService.ts:6`) | Gemini model name |
| `PRISMA_QUERY_ENGINE_LIBRARY` | set by `main.cjs:132`, read by Prisma | Prisma default | Unpacked native engine path in packaged builds |

### 3.2 Desktop shell
| Var | Read at | Default | Purpose |
|---|---|---|---|
| `PEBLO_DEV_URL` | `main.cjs:11` | unset | Dev mode: load Vite URL, skip embedded server, open DevTools |
| `PEBLO_DATA_DIR` | `main.cjs:14` | OS userData | Alternate profile dir (testing) |
| `PEBLO_API_URL` | `main.cjs:30` | unset; also `userData/server-url.txt` | Hosted mode: the window loads a remote Peblo server |
| `PEBLO_ENV_FILE` | `main.cjs:143` | unset | Explicit .env path |

### 3.3 Tooling only
| Var | Read at | Default | Purpose |
|---|---|---|---|
| `PEBLO_CANVAS_CHECK` | `main.cjs:398` | unset | Enables the in-app canvas check |
| `PEBLO_CANVAS_OUT` | `canvas-check.cjs:199` | set by runner | Output folder |
| `PEBLO_CANVAS_SHOTS` | `canvas-check.cjs:201`, `run-canvas-check.mjs:144` | runner: all 5 styles at scales 1 and 1.5, else none | Which styles to screenshot (`all` = every size/route) |
| `PEBLO_CANVAS_QUICK` | `canvas-check.cjs:14` | `0` | Only 1440×900 screenshots, no zoom tests |
| `PEBLO_CANVAS_STYLES` | `canvas-check.cjs:16` | `soft,studio,console,river,orbit` | Styles to test |
| `PEBLO_CANVAS_ROUTES` | `canvas-check.cjs:17` | `/,/notes,/tasks,/calendar,/ai,/ai/connections` | Routes to test |
| `PEBLO_CANVAS_THEME` | `canvas-check.cjs:18` | `light` | Theme |
| `CANVAS_SCALES` | `run-canvas-check.mjs:128` | `1,1.25,1.5,2` | `--force-device-scale-factor` values |

### 3.4 Client (Vite)
| Var | Read at | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | `client/src/api/client.js:7`, `AiChatPanel.jsx:334`, `SettingsModal.jsx:42`, `hooks/useHubChat.js:14`, `context/AuthContext.jsx:138` (socket URL = it with `/api` removed) | `/api` | Non-relative API base for unusual setups |
| `VITE_GOOGLE_CLIENT_ID` | defined in `client/.env.local` (committed) | n/a | **Unused**: no code references it (left over from the Google Calendar/OAuth era) |

### 3.5 Config files
- `.env.example` (root): DATABASE_URL, JWT_SECRET, KEY_ENCRYPTION_SECRET, NODE_ENV, TRUST_PROXY, ALLOWED_ORIGINS, OPENAI_API_KEY, GEMINI_API_KEY, GEMINI_MODEL=gemini-2.5-flash. It says to copy it to `server/.env`. It is missing GEMINI_API_KEYS, PORT, HOST, PEBLO_STATIC_DIR, SIGNUP_RATE_MAX and the desktop vars. The challenge's suggested `LLM_API_KEY` is not used.
- `server/src/env.ts`: loads `<compiled dir>/../.env`, else `<cwd>/server/.env`. The comment mentions Vercel (stale). From `dist/server/env.js`, `../.env` resolves to `dist/.env`, which never exists, so in practice it is always the cwd fallback.
- `.gitignore`: node_modules, `.env`, `*.db*` (SQLite leftovers), `dist/` (listed twice), `.DS_Store`, `.vscode`, `*.log`, `release/`, `server/generated/`. `.env.local` is **not** ignored, and `client/.env.local` is committed.
- `server/.gitignore`: `src/generated` (stale; generation now goes to `server/generated`, covered by the root file).
- `server/tsconfig.json`: ES2022, module/resolution Node16, strict, outDir `./dist`, rootDir `./src`, allowJs. It is used only for editor and type checks; the real build is esbuild. `scripts/seed.ts` is outside `rootDir`.

---

## 4. Database

MySQL 8 (8.0.13+ needed for expression defaults on TEXT/JSON). Prisma `prisma-client-js` with output `server/generated/prisma` and no `binaryTargets`. All tables use `utf8mb4_unicode_ci`, so comparisons are case-insensitive, including unique email and tag names. IDs are UUID strings in `VARCHAR(191)`. Every FK is `ON UPDATE CASCADE`.

### 4.1 Models
**User -> `users`**
| Field | Column / type | Notes |
|---|---|---|
| id | `id` VARCHAR(191) PK | uuid() |
| name | VARCHAR(191) | default `'You'` |
| email | VARCHAR(191) | UNIQUE `users_email_key` |
| passwordHash | `password_hash` VARCHAR(191) | bcrypt cost 12 |
| tokenVersion | `token_version` INT default 0 | added by 002; bumped by change-password and logout-all |
| jobTitle | `job_title` VARCHAR(191) NULL | |
| bio | TEXT NULL | |
| timezone | VARCHAR(191) default `'UTC'` | |
| settings | JSON NOT NULL, SQL default `('{}')` | Prisma has no default (required on create). Holds UI/AI settings (fontSize, defaultAiModel, ollamaEnabled/Url/Model…). Keys are stripped out |
| createdAt / updatedAt | DATETIME(3) | updated_at has no SQL default (Prisma sets it) |
Relations: notes, tags, aiGenerations, todos, apiKeys (1:1), quizRuns, mastery.

**Note -> `notes`**: id PK; `user_id` FK -> users CASCADE; `title` TEXT default `('Untitled')`; `content` LONGTEXT default `('')` (Markdown produced from BlockNote, lossy); `category` VARCHAR NULL; `is_archived` and `is_deleted` BOOL default false; `deleted_at` NULL (soft-delete/trash); created/updated. Indexes: `(user_id)` (redundant with the composites), `(user_id,is_archived)`, `(user_id,is_deleted)`, `(user_id,category)`, `(user_id,updated_at DESC)`. Relations: tags (NoteTag), aiGenerations, backups, linkedTodos, embedding (1:1).

**Tag -> `tags`**: id PK; `user_id` FK -> users CASCADE; `name` VARCHAR(191); created_at. UNIQUE `(user_id,name)` (per-user tags; TRD D16's global-unique issue is fixed).

**NoteTag -> `note_tags`**: PK `(note_id, tag_id)`; FK note CASCADE, FK tag CASCADE; index `(tag_id)`.

**AiGeneration -> `ai_generations`**: id; `note_id` FK -> notes CASCADE; `user_id` FK -> users CASCADE; `type` VARCHAR (summary, actions, title, promises…); `result` LONGTEXT (text or JSON, e.g. River "promises" `{items:[…]}`); created_at. Indexes `(user_id)`, `(note_id)`. Used for AI usage stats.

**NoteBackup -> `note_backups`**: id; `note_id` FK CASCADE; `content` LONGTEXT; created_at; index `(note_id)`. Version history.

**Todo -> `todos`**: id; `user_id` FK CASCADE; `text` TEXT; `is_completed` BOOL (Prisma field `completed`); `priority` VARCHAR default `'medium'`; `deadline` DATETIME(3) NULL; `tags` JSON default `('[]')` (Prisma field `todoTags`; a free-form array, **not** related to the Tag table); `linked_note_id` FK -> notes **ON DELETE SET NULL** (Prisma `noteId`); `start_time`, `end_time` VARCHAR NULL ("HH:MM" strings); `recurrence` VARCHAR NULL default `'none'` (none/daily/weekly/monthly/yearly; implemented as 30/12/12/5 pre-created copies in `todosController.ts:137-167`); created/updated. Indexes `(user_id)`, `(user_id,deadline)`, `(user_id,is_completed)`.

**NoteEmbedding -> `note_embeddings`**: id; `note_id` UNIQUE FK CASCADE; `vector` LONGTEXT (JSON float array); created_at. Almost unused (AI Hub retrieval is keyword-only, `services/retrieval.ts:1-6`).

**UserApiKeys -> `user_api_keys`**: PK/FK `user_id` -> users CASCADE; `openai_key`, `gemini_key`, `groq_key`, `huggingface_key` TEXT NULL (changed from VARCHAR(191) by 002 to fit ciphertext); updated_at. Values are `enc:v1:<iv>:<tag>:<data>` base64 AES-256-GCM.

**QuizRun -> `quiz_runs`** (Orbit style): id; `user_id` FK CASCADE; `topic` VARCHAR; `questions` LONGTEXT JSON; `answers` LONGTEXT NULL; `correct` INT NULL; `total` INT; created_at; `finished_at` NULL. Index `(user_id, topic)`.

**TopicMastery -> `topic_mastery`**: PK `(user_id, topic)`; FK users CASCADE; `score` INT 0-100; `quizzes` INT default 0; `last_correct`, `last_total` INT default 0; `missed` LONGTEXT default `('[]')` (JSON `[{concept,n}]`); updated_at.

**`_peblo_migrations`** (created by code, not in the schema): `version` INT PK, `name` VARCHAR(191), `applied_at` DATETIME(3) default now.

Cascade summary: deleting a user removes everything (the scripts rely on this for cleanup). Deleting a note removes its tags links, AI generations, backups and embedding, and nulls linked todos. Deleting a tag removes its links.

### 4.2 Migration mechanism (`server/src/db.ts`)
- The Prisma client is loaded dynamically from `server/generated/prisma` (`db.ts:22-30`, two candidate paths for src vs dist).
- `initDatabase()` memoises `migrate()` (`:85-90`), called from `startServer` and `seed.ts`.
- `migrate()` (`:52-80`): `CREATE TABLE IF NOT EXISTS _peblo_migrations`; `current = max(version)`; lists `^\d+_.*\.sql$` files in the SQL dir sorted lexically; for each version greater than `current`, splits on `;` followed by a newline or EOF, strips `--` comment lines, runs each statement with `$executeRawUnsafe`, then inserts the version row.
- Not transactional (MySQL DDL auto-commits) and no lock: see B4/B5.
- Files: `001_init.sql` (10 tables, 13 FKs, generated by `prisma migrate diff` and post-processed) and `002_account_security.sql` (four `MODIFY … TEXT NULL` on `user_api_keys`, `ADD COLUMN token_version`).
- Prisma Migrate (`prisma migrate`) is not used. `npm run db:sql` regenerates 001 from the current schema (see B6).
- History: SQLite (desktop) -> Postgres (commit ef82253) -> MySQL (3a0f1a3). README and the docs still describe SQLite.

### 4.3 Seed data (`scripts/seed.ts`, `npx tsx scripts/seed.ts [email]`, default `tejas@test.com`)
- Runs `initDatabase()`. Creates the user if missing (name "Tejas", password `password123`, bcrypt 12, settings `{}`). **Deletes** that account's quiz runs, mastery, AI generations, todos, notes and tags.
- 19 hand-written notes (DBMS normalization/ACID, OS scheduling/deadlocks, CN TCP vs UDP, exam timetable, internship log and sprint planning, two startup ideas, Atomic Habits, book list, Diwali tickets, gym plan, Peblo wishlist, LeetCode patterns, a `private`-tagged journal, an archived resume draft, a trashed scratch note), with categories College/Work/Ideas/Reading/Personal and tags.
- 68 "Daily log" filler notes over about 17 weeks (days 1-118 skipping multiples of 3 or 7) with tags `daily` / `reflection`, for the heatmap and streak. Total 87 notes.
- 2 backups on the normalization note; 3 `summary` AI generations; 1 `promises` generation (4 items: Meera, Rohit, you, Sanjana-ignored).
- 28 todos: 2 overdue, 4 today (one done, daily recurrence), 12 upcoming (with start/end times, note links, weekly and monthly recurrence), 3 undated, 7 done. Recurring tasks are seeded as single rows, unlike the API's copy behaviour.
- 4 quiz runs (dbms ×2, os, cn) and 3 mastery rows (dbms 80, os 50, cn 67). The mastery figures are inconsistent with the seeded answers (see B13).

---

## 5. Tooling scripts

| Script | Purpose | How to run | What it checks / does |
|---|---|---|---|
| `scripts/build-server.mjs` | Transpile the server | `npm run build:server` | Removes `dist/server`, then esbuild each `.ts` (not `.d.ts`) under `server/src` to ESM node20 with sourcemaps. No bundling, no type-check, so type errors such as TRD D1 ship silently |
| `scripts/make-sql.mjs` | Regenerate `001_init.sql` | `npm run db:sql` (needs prisma CLI) | `prisma migrate diff --from-empty --to-schema-datamodel … --script`; rewrites `DEFAULT 'x'` on TEXT/LONGTEXT lines to `DEFAULT ('x')`; adds `DEFAULT ('{}')` to `settings` and `DEFAULT ('[]')` to `tags`; overwrites 001 |
| `scripts/seed.ts` | Sample data for one account | `npm run seed -- you@x.com` or `npx tsx scripts/seed.ts [email]` (needs `server/.env`) | See 4.3. Destructive for that account |
| `scripts/demo-server.mjs` | Run the built app in a normal browser with a demo account | `npm run build && node scripts/demo-server.mjs [port=4777]` | Loads `server/.env`, starts the server with the SPA, signs up `demo-<ts>@peblo.test` / `demo-password` (name "Aarav Reddy"), sets `defaultAiModel:'ask'`, creates 6 notes and 10 todos (one completed), prints the credentials, and deletes the account on SIGINT/SIGTERM |
| `scripts/smoke-test.mjs` | API end-to-end smoke test (~60 checks) | `npm test` (builds the server only; also needs `client/dist` for the last check) | Uses the real `server/.env` DB with throwaway accounts `smoke-a/b-<ts>@peblo.test`, deleted in `finally`. Covers: health; 401 without a token; signup, duplicate (case-insensitive), invalid email, wrong password; profile load and update; **keys encrypted at rest (`enc:v1:`) and absent from settings JSON**; note CRUD, case-insensitive search, tag filter, backups; todos (JSON tags, daily recurrence, today, range > 5 rows), completion; dashboard insights, daily briefing, weekly report; AI without keys degrades cleanly; trash and restore; more than 50 notes returned; Notion zip-in-zip import (properties, `_all.csv` database to table, image skipped, link text) plus Obsidian front-matter; export zip of every note; Ollama check (unreachable and a fake OpenAI-compatible server); AI title via local model; SSE chat-stream creates notes; OpenAI key path via `OPENAI_BASE_URL`; local-only never falls back to cloud; AI Hub search, models, streamed answer with sources, `LOCAL_ONLY` refusal, "ask first" consent and after-consent cloud answer, no background cloud AI under "ask"; cross-account isolation (404, empty list, email takeover 409); search by tag name, `snippet=1` truncation to 400, limit/offset; change-password (403 wrong current, 400 short, new token, old token revoked); logout-all revokes every token; login rate-limit 429; SPA fallback serves index.html |
| `scripts/run-canvas-check.mjs` | Layout invariance across DPI and zoom | `npm run build && npm run check:canvas` (needs a display, Electron and the DB) | Spawns Electron per scale in `CANVAS_SCALES` with `--force-device-scale-factor`, a throwaway `PEBLO_DATA_DIR` and `PEBLO_CANVAS_CHECK=1`, with a 15-min timeout per run. Compares each probe with the 100 % baseline (same style/route/size): canvas must fill the window (width capped at 2160), keep 900 px height or 1440 px width, no element count change, no text rewrap, drift at most 2+1/zoom (or 6 at other scales); content-only differences are reported, not failed. Writes `release/canvas-check/report.md`, per-scale `result.json`, `page-errors.txt` and PNGs. Exit 1 on failure |
| `scripts/canvas-check.cjs` | In-app half of the canvas check | Loaded by `main.cjs:398` | Disables occlusion and backgrounding throttles. Waits for the main window, signs up `canvas-check-<ts>@peblo.test`, seeds 9 notes, 7 tasks and 6 timed meetings via fetch, writes 5 `topic_mastery` rows directly with Prisma. For each style (5) × route (6): loads, resizes through 8 sizes (or 1 in QUICK), probes every element rect, line count and text in design pixels, then presses Ctrl+ ×3, Ctrl− ×6, Ctrl+wheel ×4 and Ctrl0 at 1440×900 and 1280×720. Collects console errors, deletes the account, writes results and calls `app.exit(0)` |

---

## 6. Documentation inventory and gap list

### 6.1 Inventory
| File | Purpose | Freshness |
|---|---|---|
| `README.md` | User and dev readme | **Very stale**: says "no accounts", SQLite `peblo.db`, `peblo-dev.db`, `PRAGMA user_version` migrations, `Peblo Setup x.y.z.exe`, "throwaway database" tests (README:5, 31, 46, 69, 74, 87, 94). Lists real features (quick capture, import/export, Ollama) correctly |
| `docs/README.md` | Index of docs 00-06, founder decisions (name, confidential PDF, licence, path, signing budget), cross-team gap table, 30-day plan | Written 26 Sep 2026 against the SQLite single-user build. Several gaps since closed (auth, per-user tags, key encryption, `/ai` page) |
| `docs/DEPLOYMENT.md` | Hosting the server (MySQL, env vars, `npm run serve`, desktop to remote via `PEBLO_API_URL`) | Current. States gaps: no password reset or email verification, Ollama means the server's machine, chat history only in the browser |
| `docs/00-vision-and-strategy.md` | Vision, bets, beachhead, paths A-D (recommends B "memory for your AI tools"), business model, moats, milestones, founder plan, risks | Strategy |
| `docs/01-prd.md` | Personas, JTBD, requirement IDs (CAP, KN, ACT, HUB, MCP, CON, DATA, PLAT) with priority, phase, status and acceptance; NFRs; metrics; release plan; gap table | Status column partly stale |
| `docs/02-trd.md` | Current vs target architecture (Peblo Core, storage and model adapters, event bus), bugs D1-D17, ADR-1..7, security (local API token, safeStorage, SQLCipher, Electron hardening), perf budgets, roadmap | Assumes SQLite and local-first |
| `docs/03-mcp.md` | Peblo MCP Server (stdio bridge, MCPB bundle, permissions and scopes, 11 tools with JSON schemas, resources, prompts, client config snippets, implementation plan, tests) and Peblo Connect (MCP client: config, safe spawning, OAuth, approvals, injection defences) | Nothing built |
| `docs/04-ai-hub.md` | AI Hub spec: model picker, hardware hints, RAG pipeline (chunking, embeddings, hybrid retrieval, citations), context budgeting, tools and automations, data model, SSE protocol, evaluation, prompt files, sequence diagrams | Partly built (page, keyword retrieval, SSE, consent) |
| `docs/05-design.md` | UI audit, IA and navigation (sidebar), shortcut map, screen specs (AI Hub, Connections, onboarding, quick-capture refinements, Smart Intake review, Inbox), design system, a11y | Partly built (styles, `/ai`, `/ai/connections`) |
| `docs/06-go-to-market.md` | Competitors, positioning, ICP, messaging, naming risk, pricing (Founding Supporter ₹499/$19, later Sync+Pro), channels, launch, trust and signing, telemetry, interviews | Non-code |
| `docs/design/*.svg` | Wireframes: navigation, ai-hub, ai-hub-tool-approval, connections, onboarding | |
| `done.txt` | Old codebase analysis of the **original web app** (index.js, refresh tokens, `/api/shared` share controller, floating navbar, heatmap px specs) | Stale (none of share, refresh tokens or navbar exists now) |
| `implementation_plan.md` | Original challenge plan (Postgres, Gemini, phases 1-8 all ticked including public sharing and markdown preview) | Stale; sharing was removed in commit 50861e5 |
| `peblo_improvement_proposal.md` | AI-written proposal: Google Calendar two-way sync marked **COMPLETED** (`calendarController.ts`), strict TS COMPLETED, PWA/offline, pgvector RAG, Whisper intake, diff viewer, theme presets, editor `/ai` | `calendarController.ts` does not exist; the claims are false for this tree. Links are absolute `file:///home/tejas/...` paths |
| `peblo_improvement_roadmap.md` | AI chat transcript: React Query, PWA, Zustand, Zod, TS migration, pgvector, file/audio intake, SSE streaming, BlockNote, multiplayer | Mostly done (React Query, Zustand, Zod, TS, SSE, BlockNote); the file ends with a stray "10:12" |
| `.kiro/specs/client-side-cache/requirements.md` (+ `.config.kiro`) | Kiro spec for an in-memory SWR cache (`Cache_Manager`, `useDataWithCache`), TTL 60 s, invalidation on mutation, session-scoped, dedupe, endpoints `/dashboard/insights`, `/notes`, `/notes/:id`, `/shared/:shareId` | Superseded by TanStack Query (used in about 31 client files). References `DashboardPage` and `SharedNotePage`, which no longer exist |

### 6.2 Planned-but-unbuilt features (verified by grep against code)
Status: Missing = no code; Partial = something exists.

**Capture**
- CAP-02 time/recurrence/reminder parsing in quick capture: Missing (`client/src/utils/parseTask.js` handles dates, `!priority`, `#tag`). [01-prd]
- CAP-03 Inbox triage view with badge and shortcuts: Partial at most (an "inbox" tag and per-style capture screens; no triage workflow). [01-prd, 05 §4.6]
- CAP-04 Smart Intake review-before-save: Missing (saves immediately). [01-prd, 05 §4.5]
- CAP-05 multi-file / long-PDF chunked intake: Missing. [01-prd]
- CAP-07 import images/attachments and `[[wikilinks]]`: Missing (the smoke test asserts images are skipped). [01-prd]
- CAP-08 Todoist/TickTick CSV and `.ics` import: Missing. [01-prd]
- CAP-09 capture via MCP: Missing. [01-prd]
- CAP-10 local voice transcription: Partial (voice commands; no local Whisper). [01-prd, proposal]
- CAP-11 web clipper / share target: Missing. [01-prd]

**Knowledge**
- KN-02 `[[links]]` and backlinks: Missing. [01-prd]
- KN-03 ranked full-text search (FTS) across notes and tasks: Partial (Prisma `contains`; the Hub uses keyword scoring). [01-prd, 02]
- KN-04 chunked embeddings and hybrid search: Missing (`note_embeddings` is one vector per note, unused; `retrieval.ts` says "no embeddings yet"). [01-prd, 04 §5, proposal and roadmap "pgvector"]
- KN-05 / HUB-03 ask-your-notes with citations: Partial (`/api/ai/hub/chat` streams answers with numbered keyword-retrieved sources; no block-level citations). [01, 04]
- KN-06 attachments; KN-07 related notes; KN-08 daily note; KN-09 templates: Missing. [01-prd]

**Action**
- ACT-02 RRULE recurrence series: Missing (copies, `todosController.ts:137-167`). [01, 02 D9]
- ACT-03 native per-task reminders from main, snooze: Missing (the main process only shows the tray-hint notification; reminders are the renderer "AI voice call"). [01-prd]
- ACT-05 week view with time blocking; ACT-06 ICS subscribe / Google two-way sync: Missing (proposal claims Google sync is COMPLETED; there is no code and no googleapis dep). [01, proposal]
- ACT-07 Today/Upcoming with one-key reschedule: Partial. [01]
- ACT-08 projects and subtasks: Missing. [01]
- ACT-01 todo tags as a real relation: Missing (JSON column). [01, 02]

**AI Hub**
- HUB-01 dedicated `/ai` page: built (route exists; `Ctrl/Cmd+J` panel not verified). [01, 05]
- HUB-02 per-conversation model picker: Partial (`/api/ai/hub/models`, provider/model in request body). [01, 04]
- HUB-04 scope control: Partial (`noteIds`, `#private` exclusion `excludedPrivate`). [01]
- HUB-05 conversation history stored server-side, searchable, exportable: Missing (localStorage only, `useHubChat.js:10`; DEPLOYMENT notes this). [01, 04 F2]
- HUB-06 actions from chat with preview/confirm and undo: Missing (chat panel writes directly). [01]
- HUB-07 connections manager: Partial (`/ai/connections` page; the MCP section shows "Coming next", `ConnectionsPage.jsx:179-187`). [01, 05 §4.2]
- HUB-08 any OpenAI-compatible endpoint: Partial (Ollama via `/v1`; no generic base URL setting). [01, 04 F1]
- HUB-09 automations / scheduled agents: Missing (no scheduler). [01, 04 §7.3]
- HUB-10 editable prompt library: Missing (prompts hard-coded in `aiService.ts`). [01, 04 §11]
- HUB-11 usage/token/cost transparency: Missing. [01]
- HUB-12 global AI-off switch: Missing. [01]
- HUB-13 hardware-aware model guidance and one-click pull: Missing. [01, 04 §4]
- 04 F4 `@`-attach notes and files in the Hub; F5 native tool calling; F9 save answer as note; context-window budgeting (`num_ctx`); evaluation set: Missing. [04]

**MCP (03-mcp.md)**: all of MCP-01..09 (stdio server via `peblo-mcp` bridge, tools `search_notes` / `get_note` / `list_recent_notes` / `ask_notes` / `create_note` / `append_to_note` / `list_tasks` / `get_agenda` / `create_task` / `update_task` / `complete_task`, one-click client setup, per-client scopes, audit log, safe writes, resources and prompts, rate limits, HTTP transport) and all of CON-01..07 (Peblo Connect: add servers, per-tool approvals, visible tool calls, injection guardrails, presets, health, automations). No `@modelcontextprotocol` dependency exists.

**Data and security**
- DATA-01 full export (tasks, ICS, AI chats, settings, attachments): Missing (notes-only Markdown zip). [01]
- DATA-02 automatic DB backups and a pre-migration snapshot: Missing (and now a MySQL concern, not a file copy). [01, 02 D7]
- DATA-03 keys in the OS keychain (`safeStorage`): Missing. Keys are AES-GCM encrypted in MySQL, but **returned decrypted to the renderer and cached in localStorage** (`services/profile.ts:17-23`, `AuthContext.jsx:72,183`). [01, 02 §7.2]
- DATA-04 local API per-launch token, Host/Origin checks: replaced by JWT accounts; no Host check and permissive localhost CORS remain (`index.ts:45-52`). [02 §7.1]
- DATA-05 encryption at rest; DATA-06 storage adapters / Markdown vault; DATA-07 E2E sync; DATA-08 delete-everything: Missing. [01, 02]
- 02 §3 "Peblo Core" (services decoupled from Express, utilityProcess, storage adapter, Kysely), ADR-6 monorepo `packages/*`: Missing. [02]
- 02 §7.5 Electron hardening (CSP, fuses, `openExternal` allow-list exists, Renovate): mostly Missing.

**Platform**
- PLAT-02 signing and notarization; PLAT-03 auto-update; PLAT-04 opt-in telemetry and crash reports; PLAT-05 CLI; PLAT-07 mobile; PLAT-08 web client (partly possible via hosted mode); PLAT-09 plugin API; PLAT-10 onboarding: Missing. [01, 02, 06]
- PLAT-06 keyboard-first palette: Partial (`CommandPalette.jsx`). [01]
- CI type-check (`tsc --noEmit`) and tests in CI: Missing. [docs/README, 02 §9]
- Design (05 §6): token cleanup, left-sidebar shell (partially: `components/shell/Sidebar.jsx`), focus styles and WCAG AA, UI tests (visual regression and axe; the canvas check is a partial substitute), sharing/teams UI: Missing or partial.

**Other plans**
- Kiro client-side SWR cache spec: not implemented as specified; functionally covered by TanStack Query. Its `/shared/:shareId` endpoint does not exist.
- Proposal: PWA/offline (Dexie, Workbox service worker), theme presets (Aura/Cyberpunk/Forest/Nordic; current themes are light/dark/midnight/system plus 5 layout styles), BlockNote `/ai` slash commands (a `/block/ai` endpoint exists, so possibly partial), diff viewer (`DiffViewer.jsx` exists, so built), Google Calendar sync (claimed, absent).
- Roadmap: multiplayer/Yjs collaboration: Missing (Socket.IO is used only for "refresh" events).
- Company decisions (docs/README §Decisions): rename (name collides with the employer's "Peblo"), remove the confidential PDF from history, add a LICENSE (none exists): all still open.

---

## 7. Original challenge requirements (PDF) vs the current app

The PDF (`Peblo_Full_Stack_Developer_Challenge.docx.pdf`, 9 pages, every page marked "Confidential — for candidate evaluation") asks for "Build a Collaborative AI Notes Workspace", any stack, deliverables GitHub repo + README + demo video + sample outputs.

| # | Requirement | Status | Evidence / note |
|---|---|---|---|
| 1 | Auth: signup and login | Met | `routes/auth.ts:21,44` (zod-validated, case-insensitive email) |
| 1 | Protected routes and pages | Met | `authenticate` middleware on every router; `AuthScreen.jsx` gate; Socket.IO auth |
| 1 | Persistent sessions | Met | 30-day JWT in localStorage; tokenVersion revocation; logout-all |
| 1 | Secure password handling | Met | bcrypt cost 12, min 8 chars, rate-limited login and signup. No password reset (DEPLOYMENT) |
| 2 | Create and edit notes | Met | BlockNote editor, `/api/notes` CRUD |
| 2 | Auto-save | Met | `useAutoSave` in `hooks/useNoteDoc.js:90`; server backups |
| 2 | Tags and categories | Met | Per-user Tag table plus `category` column |
| 2 | Archive | Met | `POST /api/notes/:id/archive`, `is_archived`; also trash and restore |
| 3 | AI summaries | Met | `POST /api/notes/:id/ai/summary` (OpenAI / Gemini / Ollama cascade) |
| 3 | Action items | Met | `/:id/ai/actions` |
| 3 | Suggested titles | Met | `/:id/ai/title` (also tags) |
| 4 | Keyword search | Met | `GET /api/notes?search=` (title, content, tag names; case-insensitive) |
| 4 | Filter by tags | Met | `?tag=` |
| 4 | Sort by recently updated | Met | `sort=updated` default (`notesController.ts:83,120`) |
| 5 | **Public share link, no-login access, public/private visibility, clean public page** | **Not met** | Sharing existed in the original web version (commits 2a368e7, 8405684) and was removed when the app became a desktop app (50861e5). No `shareId` column, no `/shared` route, only an orphan `client/src/styles/share-modal.css`. In desktop mode the server is bound to 127.0.0.1, so public sharing would only be possible in hosted mode |
| 6 | Dashboard: total notes, recently edited, most-used tags, AI usage stats, weekly activity | Met | `GET /api/dashboard/insights` (totalNotes, recentNotes, topTags, aiUsage{total,byType}, heatmap, streak), `/weekly-report` (7-day breakdown) |
| Sub | GitHub repo with frontend and backend source | Met | |
| Sub | README explaining architecture and setup | Partially met | README exists but describes the old SQLite, no-accounts architecture; setup is wrong for MySQL (no DB creation step, wrong test description) |
| Sub | `.env.example` | Met | Root `.env.example` (names differ from the PDF's `LLM_API_KEY`) |
| Sub | How to test the application | Partially met | `npm test` documented, but it needs a live MySQL plus `client/dist` |
| Sub | Demo video / sample outputs (API responses, AI summaries, schema dump, screenshots) | Not in repo | Only the canvas-check screenshots can be generated; no samples folder |
| Guideline | No secrets committed | **Violated in history** | Commit `9ec68f9` "Create .env" added `server/src/.env` containing what appear to be a real Supabase Postgres `DATABASE_URL` and a real `GEMINI_API_KEY` (`AIza…`). Removed from the tree but still in git history and pushed. `client/.env.local` (Google OAuth client ID, low sensitivity) is tracked |
| Guideline | Runs from a clean clone | Partially met | Needs a MySQL 8 server plus `server/.env`; npm 11 install-script approval caveat |
| Nice | Realtime collaboration | Not met | Socket.IO only pushes refresh events to the same user |
| Nice | Markdown preview | Met (rich block editor, Markdown storage) | |
| Nice | Optimistic UI | Met | e.g. `TodoListPanel.jsx:26` `onMutate` |
| Nice | Keyboard shortcuts | Met | Ctrl+K palette, global capture hotkey |
| Nice | Dark mode | Met | light / dark / midnight / system |
| Nice | Deployment link | Not met (hosted mode is documented, nothing deployed) | |
| Nice | Automated tests | Partially met | API smoke test plus canvas check; not in CI; no unit tests |

---

## 8. Bugs, risks, stale files and inconsistencies

### Security and data
- **S1. Secrets in git history.** `9ec68f9:server/src/.env` holds an apparently real Supabase DB URL (with password) and a Gemini API key. Rotate both and purge the history (BFG / filter-repo plus force-push). Values are intentionally not reproduced here.
- **S2. Shared-MySQL desktop architecture.** Every desktop install needs `DATABASE_URL` for the **shared multi-user database** in a local `.env` (`main.cjs:136-163`, `db.ts:7-15`). Anyone with the app's config can connect to MySQL directly and read every user's notes and encrypted keys; per-user isolation exists only in app code. Desktop installs should use hosted mode (`PEBLO_API_URL`) or a per-user local DB. This also contradicts every doc's "local-first, your data on your computer" promise (README:5, docs/00, docs/01).
- **S3. API key encryption breaks across machines.** With no `KEY_ENCRYPTION_SECRET`/`JWT_SECRET` in `.env`, each desktop install generates its own random `JWT_SECRET` (`main.cjs:150-159`), which `secrets.ts:11` also uses as the key-encryption secret. Keys saved on machine A decrypt to `null` on machine B or on the hosted server (`secrets.ts:24-31`), and re-saving on B makes A's copy unreadable. Set one shared `KEY_ENCRYPTION_SECRET`, or move to safeStorage.
- **S4. Decrypted keys reach the renderer.** `GET /api/profile` puts decrypted keys back into `settings` (`services/profile.ts:17-23`), and the client caches them in `localStorage['peblo-settings']` (`AuthContext.jsx:72,183`). A 401 path (`api/token.js:24-29`) clears only the token, not `peblo-settings`. Local stale settings also override the DB (`{...u.settings, ...prev}`, `AuthContext.jsx:71`; TRD D13 is still present).
- **S5. Authenticated SSRF.** `GET /api/ai/link-preview?url=` fetches any URL server-side (`aiController.ts:245-262`), and `GET /api/ai/ollama/check?url=` plus the per-user `ollamaUrl` setting let a user make the server call arbitrary hosts. This is harmless on desktop but a real issue in hosted mode (DEPLOYMENT.md:34 hints at it).
- **S6.** No CSP anywhere; permissive CORS for any localhost origin (`index.ts:48`); `isInternal` trusts every localhost port for `window.open` and navigation (`main.cjs:97-104`); `toggleDevTools` is in the production menu (`main.cjs:334`); no Electron fuses.
- **S7.** `aiRoutes` is mounted twice (`/api/notes` and `/api/ai`, `index.ts:63-65`), so `/api/notes/link-preview`, `/api/ai/:id/ai/summary` and similar duplicate endpoints exist.
- **S8.** The confidential challenge PDF is committed at the repo root (and pushed), and there is no LICENSE (docs/README decisions 2 and 3).

### Desktop packaging and runtime
- **B1. A fresh install cannot start.** The packaged app looks for `<appPath>/server/.env` (`main.cjs:145`), which is inside the asar and not in `build.files`. A new user gets "DATABASE_URL is not set. Put your MySQL connection string in server/.env…" (`main.cjs:161`), advice that is impossible in an installed app. The only working options are `<userData>/.env` or `PEBLO_ENV_FILE`, and neither is documented in README or DEPLOYMENT. There is no first-run UI to enter a server URL or DB.
- **B2. macOS x64 build likely broken.** `schema.prisma:1-5` has no `binaryTargets`, so `prisma generate` on the arm64 `macos-latest` runner produces only the darwin-arm64 engine, yet `package.json:112-121` builds both x64 and arm64 dmgs. The x64 app would fail to load the engine. Add `binaryTargets = ["native","darwin","darwin-arm64"]` and make `configurePrismaEngine` (`main.cjs:131`, which takes the first `query_engine*.node`) pick the one for the right arch.
- **B3. Possible duplicate publishing.** `electron-builder` runs on tag builds with `GH_TOKEN` set and no `--publish never`, and the workflow separately runs `softprops/action-gh-release` (`build-desktop.yml:44-48,61-72`). electron-builder may try to auto-publish to GitHub on tags. Pass `--publish never`, or configure `publish` and drop the second job.
- B-misc: the API runs in the Electron main process (TRD D5). `PEBLO_CANVAS_CHECK=1` on a packaged build crashes because `scripts/` is not packaged (`main.cjs:398`). The tray item `/todolist` relies on a redirect (`main.cjs:315`, `App.jsx:102`). `npm start` runs a production build with `NODE_ENV=development` (stack traces in error JSON) because `isPackaged` is false.

### Database and migrations
- **B4. No migration lock.** Every desktop client and hosted server runs `migrate()` against the same MySQL at startup (`db.ts:52-80`). Two clients starting during an upgrade both apply `002` and the second fails with "Duplicate column 'token_version'", so that user sees "Peblo could not start". Use `GET_LOCK('peblo_migrate')` or a version-row insert-first pattern.
- **B5. Partial failure is unrecoverable.** Statements auto-commit and the version row is written last (`db.ts:74-77`), so a mid-file failure leaves tables half-created. 001/002 use plain `CREATE TABLE` / `ADD COLUMN` (no `IF NOT EXISTS`), so every later start fails until someone fixes the DB by hand. There is also no backup before migrating (TRD D7), and the `;\n` split breaks on procedures and triggers.
- **B6. `npm run db:sql` is a footgun.** `make-sql.mjs:51` regenerates `001_init.sql` from the current schema, which now includes `token_version` and TEXT key columns. On a fresh DB, 002's `ADD COLUMN token_version` then fails. Existing DBs never re-run 001, so 001 and the schema have drifted by design. Freeze 001 and remove or update the script.
- B7. `users.settings` has a SQL default but no Prisma default, so every Prisma `create` must pass settings. `updated_at` columns have no SQL default, so raw inserts fail. There is a redundant `notes(user_id)` index. `note_embeddings` is a dead table. Todo tags are JSON and unrelated to `tags`.
- B8. Recurrence creates 30/12/12/5 copies (`todosController.ts:137-167`): a daily series ends after 30 days and cannot be edited as a series (TRD D9). The seed creates recurring tasks as single rows, so seeded data behaves differently from API-created data.
- B9. Dashboard fakes activity: if today has none, it sets `total=1, updated=1` (`dashboardController.ts:111-118`), inflating streaks and heatmaps. Day keys are UTC (`toISOString().split('T')[0]`, `dashboardController.ts:111,307-308`, `utils/activityStats.ts:4`), so for IST users activity between 00:00 and 05:30 lands on the previous day.

### Build, test and CI
- B10. No type-check anywhere (esbuild only, `build-server.mjs`). TRD D1 (a `p.model` ReferenceError) shipped exactly this way. CI runs no tests.
- B11. `npm test` builds only the server, but the last check needs `client/dist` (`smoke-test.mjs:328`; `package.json:31`), so it fails from a clean clone unless the client was built. The smoke test, canvas check and demo server all write throwaway accounts into **whatever DB `server/.env` points at**, which may be production. The README calls this a "throwaway database" (README:74), which is wrong.
- B12. `scripts/demo-server.mjs` does not set `JWT_SECRET`, so it falls back to the insecure dev default if `.env` lacks one. The demo account's cleanup only runs on SIGINT/SIGTERM, so a crash leaves it behind.
- B13. Seed inconsistencies: `topic_mastery` contradicts the seeded quiz runs (`seed.ts:483-502`). The dbms second run answers `[1,0,1,0,3]` = 5/5 but mastery says 4/5; os `[0,0,1,0]` vs key `[0,0,1,1]` = 3/4 vs 2/4; cn 3/3 vs 2/3. Seed passwords are weak and fixed (`password123`).

### Docs and stale files
- B14. README (lines 5, 24, 31-37, 46, 69, 74, 87, 94, 99) describes the pre-MySQL, no-account SQLite app; the installer filename is wrong (actual `Peblo-1.0.0-win-x64.exe`); there is no MySQL setup section.
- B15. `docs/README.md` and 01/02/04/05 describe the SQLite local-first build: "no auth" (D3), plaintext keys (D4), global tags (D16), "no AI Hub page" (HUB-01) are all outdated, and status columns need refreshing. TRD D6 (stack leak) is fixed (`errorHandler.ts:18`, development only).
- B16. `done.txt` describes the original web app (index.js, refresh tokens, `/api/shared`, `shareController`, floating navbar). `implementation_plan.md` ticks public sharing and the Postgres stack. `peblo_improvement_proposal.md` claims a non-existent `calendarController.ts` (Google Calendar sync "COMPLETED") and links to `file:///home/tejas/...`. `peblo_improvement_roadmap.md` is a pasted chat ending in "10:12". The `.kiro` spec targets `SharedNotePage`, `DashboardPage` and `/shared/:shareId`, none of which exist.
- B17. Stray files: `Untitled` (33 bytes: "hey check my website isnt working", tracked); `Peblo_Full_Stack_Developer_Challenge.docx.pdf` (confidential, tracked); `client/src/styles/share-modal.css` (orphan); `client/.env.local` with an unused `VITE_GOOGLE_CLIENT_ID`; `server/.gitignore` entry `src/generated` (stale); `.gitignore` lists `dist/` twice and SQLite `*.db*` patterns; `server/src/env.ts:9` comment about Vercel.
- B18. `.env.example` is missing `GEMINI_API_KEYS` (DEPLOYMENT lists it), `PORT`, `HOST`, `PEBLO_STATIC_DIR`, `SIGNUP_RATE_MAX` and the desktop vars (`PEBLO_API_URL`, `PEBLO_ENV_FILE`, `PEBLO_DATA_DIR`). It tells users to copy it to `server/.env` without saying the packaged app reads `<userData>/.env`.
- B19. Deprecated `@google/generative-ai` SDK (TRD D12). Hard-coded model names (`gpt-4o-mini`, `gemini-2.5-flash`).
