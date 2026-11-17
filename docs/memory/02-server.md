# Peblo server — reverse-engineering report

> **Correction (7 Nov 2026):** this report was written against the MySQL-era code on branch pp. The database is now **Postgres** (Supabase, CITEXT, transaction-level advisory lock, migrations in server/prisma/sql/), the live branch is supabase, password reset and email verification exist, the desktop app has an auto-updater, and packaged builds default to the hosted server. Treat MySQL details below as history; see [07-history-and-decisions.md](07-history-and-decisions.md).


Scope: `server/src` (Express 4.22, Prisma 6 on MySQL, Socket.IO 4, Zod 4.6, OpenAI SDK 6, `@google/generative-ai` 0.21, multer 2, pdf-parse 1, adm-zip, bcryptjs, jsonwebtoken). The files are TypeScript ESM. `river.ts` and `study.ts` are covered by someone else, so this report only lists their endpoints. All line numbers are file-relative.

File sizes: aiService 1147 lines, aiChatController 450, dashboardController 329, notesController 384, aiController 299, todosController 280, importService 209, retrieval 169, activityStats 142, index 138, others under 105.

---

## 1. Startup sequence (`index.ts`)

**Module load**
1. `import './env.js'` runs first. It loads `server/.env` (relative to the compiled file) or else `<cwd>/server/.env` with dotenv. On a host, the platform supplies the variables.
2. Importing `db.ts` throws at import time if `DATABASE_URL` is unset (db.ts:10-15). It then loads the generated Prisma client from `server/generated/prisma` (two candidate paths, db.ts:22-30) and creates a single `PrismaClient`.
3. Importing `middleware/auth.ts` checks the JWT secret. In `NODE_ENV=production` it throws if `JWT_SECRET` is missing, shorter than 16 characters, or equal to the dev default (auth.ts:10-15). Otherwise it warns and uses `'dev-only-insecure-secret-change-me'`.

**`startServer({port=0, staticDir, host='127.0.0.1'})`** (index.ts:87-120)
1. `initDatabase()` runs the custom SQL migrator (db.ts:52-80):
   - Creates `_peblo_migrations(version, name, applied_at)`.
   - Reads `prisma/sql/NNN_*.sql` (or `PEBLO_SQL_DIR`) and splits each file on `;` followed by a newline.
   - Strips `--` comments, runs each statement with `$executeRawUnsafe`, then inserts the version row.
   - Files present: `001_init.sql` (11 tables) and `002_account_security.sql` (widens the key columns to TEXT and adds `users.token_version`).
2. `protectExistingKeys()` (services/profile.ts:36-57):
   - Encrypts any plaintext API keys in `user_api_keys`.
   - Moves any key fields out of `users.settings` JSON into that table.
   - It scans **every user** on every boot. Errors are only logged.
3. `createApp(staticDir)`, in this order:
   1. `trust proxy` from `TRUST_PROXY` (`'true'` → true, a number → hop count, else the raw string) (index.ts:40).
   2. **CORS** (index.ts:44-52):
      - Allowed: no `Origin` (Electron, curl), any `http(s)://localhost:<port>` or `127.0.0.1:<port>`, and the comma-separated `ALLOWED_ORIGINS`.
      - Anything else gets `Error('Not allowed by CORS')`, which becomes a 500 through the error handler.
      - No credentials or cookies are involved; auth is a Bearer header.
   3. `express.json({ limit: '10mb' })` (index.ts:53). There is no urlencoded parser.
   4. `GET /api/health` → `{status:'ok', timestamp}`, with no auth (index.ts:56-58).
   5. Routers, in mount order (index.ts:60-71):

      | Prefix | Router |
      |---|---|
      | `/api/auth` | auth |
      | `/api/profile` | profile |
      | `/api/ai/hub` | hub |
      | `/api/notes` | notes |
      | `/api/notes` | **ai** (mounted a second time here) |
      | `/api/ai` | ai |
      | `/api/ai` | aiChat |
      | `/api/dashboard` | dashboard |
      | `/api/todos` | todos |
      | `/api/study` | study |
      | `/api/river` | river |
      | `/api` | transfer (has a router-level `authenticate`) |

   6. `app.use('/api', errorHandler)` (index.ts:73).
   7. If `staticDir` exists: `express.static(staticDir, {index:false})` plus an SPA fallback. Any non-`/api/` GET returns `index.html` (index.ts:75-81).
   8. A final `errorHandler` (index.ts:83).
4. `http.createServer(app)` and Socket.IO `new SocketIOServer(httpServer)`:
   - Default options, so Socket.IO's CORS is the library default.
   - The handshake middleware calls `verifyToken(socket.handshake.auth.token)` and rejects with "Sign in to continue."
   - On connection, the socket joins a room named `userId`. The server is stored as `app.set('io', io)` (index.ts:96-110).
   - Clients cannot send any events to the server; it is broadcast-only.
5. `listen(port, host)`. Port 0 means a random free port, which is what Electron uses; it binds to 127.0.0.1. The function returns the actual port.

**Direct run** (`npm run dev` / `serve`, index.ts:123-138):
- `PORT || 3001`.
- `HOST || (production ? '0.0.0.0' : '127.0.0.1')`.
- Static files from `PEBLO_STATIC_DIR || <cwd>/client/dist`, in production only.

**Electron** (`electron/main.cjs:141-180`):
- Loads `.env` from `PEBLO_ENV_FILE`, then `<userData>/.env`, then `<app>/server/.env`.
- If `JWT_SECRET` is unset, it **generates a random per-install secret** stored in `<userData>/.jwt-secret`.
- Requires `DATABASE_URL`. Sets `NODE_ENV=production` in packaged builds.
- Calls `startServer({port:0, staticDir: client/dist})`.

**Error handler** (middleware/errorHandler.ts):
- Logs `err.message`.
- Prisma `P2002` → 409 "A record with this value already exists". `P2025` → 404 "Record not found".
- Otherwise `err.statusCode || 500` with `{error: err.message}`. The stack is included only when `NODE_ENV==='development'`.

**Environment variables read in `server/src`:**
- `DATABASE_URL`, `JWT_SECRET`, `KEY_ENCRYPTION_SECRET`
- `OPENAI_API_KEY`, `GEMINI_API_KEYS` / `GEMINI_API_KEY`, `GEMINI_MODEL`
- `TRUST_PROXY`, `ALLOWED_ORIGINS`, `SIGNUP_RATE_MAX`
- PEB-106: the account setting `aiOff` (Settings > AI Providers > Turn off all AI) makes every AI route answer 403 `AI_OFF` (`middleware/aiOff.ts`, first in `aiLimit`) and makes `aiService` build no provider.
- PEB-26 limits: `AI_DAILY_LIMIT` (AI requests per account per rolling 24 h, default 500, 0 = off), `AI_BURST_MAX` (per minute, default 20, 0 = off), `API_RATE_MAX` (any /api call per address per minute, default 1200, 0 = off), `SERVER_AI_KEYS=off` (ignore `OPENAI_API_KEY` / `GEMINI_API_KEYS`; only keys people saved themselves are used). Counts are in memory (one server process) and reset on restart. The AI limit is `aiLimit` in `middleware/rateLimit.ts`, put after `authenticate` on every route that calls a provider
- `NODE_ENV`, `PORT`, `HOST`, `PEBLO_STATIC_DIR`, `PEBLO_SQL_DIR`

**Tables** (`schema.prisma`):
- `users`: id uuid, name, email unique, password_hash, token_version, job_title, bio, timezone (default "UTC"), settings JSON, timestamps.
- `notes`: title TEXT, content LONGTEXT, category, is_archived, is_deleted, deleted_at, timestamps. Indexes on (userId), (userId, isArchived), (userId, isDeleted), (userId, category), (userId, updatedAt desc).
- `tags`: per user, unique (userId, name).
- `note_tags`: primary key (noteId, tagId).
- `ai_generations`: noteId is **required**, userId, type, result LONGTEXT.
- `note_backups`
- `todos`: text, is_completed, priority string, deadline DateTime?, tags JSON (`todoTags`), linked_note_id (SetNull on delete), start_time / end_time strings, recurrence, timestamps.
- `note_embeddings`: noteId unique, vector stored as a JSON string.
- `user_api_keys`: openai, gemini, groq and huggingface keys as TEXT.
- `ai_connections`: one row per extra AI provider a person added (provider, label, base_url, encrypted api_key, model, enabled, position); see §2.7b.
- `quiz_runs`, `topic_mastery`.

All user-owned tables cascade on user delete.

---

## 2. Endpoint catalogue

**Shared conventions**
- "Auth": `authenticate` (Bearer JWT, plus a DB lookup that checks `tokenVersion`).
- "RL": in-memory rate limit.
- Zod validation exists **only** on `POST/PATCH /api/notes` and `POST/PATCH /api/todos`. Everything else checks fields by hand.
- Errors are `{error}`. Validation errors are meant to be `{error:'Validation Error', details:[{path,message}]}`, but see bug B5.

### 2.1 Health
| Method | Path | Auth | Does | Response |
|---|---|---|---|---|
| GET | `/api/health` | no | liveness probe | `{status:'ok', timestamp}` |

### 2.2 Auth (`routes/auth.ts`)
| Method | Path | Auth | RL | Validation | Does | Tables | Response |
|---|---|---|---|---|---|---|---|
| POST | `/api/auth/signup` | no | 10 per hour per IP (`SIGNUP_RATE_MAX`) | email regex, password 8-200 chars, name trimmed to ≤80 (defaults to the email local-part) | Checks the email is free (409 if taken). Hashes with bcrypt cost 12. Creates the user with `settings:{}`. | users (r/w), user_api_keys (r) | 201 `{token, user: loadProfile}` |
| POST | `/api/auth/login` | no | 10 per 15 min per IP | email lower-cased, password cut to 200 | `bcrypt.compare`; 401 "Incorrect email or password." | users | `{token, user}` |
| POST | `/api/auth/change-password` | yes | 8 per 15 min per IP (after auth) | new password 8-200 | Verifies the current password (403 if wrong). Re-hashes and increments `tokenVersion`, which signs out other devices. | users | `{token, message}` |
| POST | `/api/auth/logout-all` | yes | – | – | Increments `tokenVersion`, which invalidates every token including this one | users | `{message}` |
| POST | `/api/auth/delete-account` | yes | `password` | Checks the password (403 if wrong, same limiter as change-password), then `prisma.user.delete`; every table cascades (notes, tags, todos, series, api keys, quiz runs, mastery, backups, embeddings). Drops the account's sockets (PEB-25) | all | `{message}` |

### 2.3 Profile (`routes/profile.ts`, `controllers/profileController.ts`)
| Method | Path | Auth | Validation | Does | Tables | Response |
|---|---|---|---|---|---|---|
| GET | `/api/profile` | yes | – | `loadProfile` | users, user_api_keys | `{user:{id,name,email,jobTitle,bio,timezone,settings(+decrypted keys)}}` |
| PUT | `/api/profile` | yes | Email regex and uniqueness (409). Name ≤80. jobTitle, bio and timezone are **not checked**. `settings` is merged shallowly over the existing JSON. | Strips the 4 key fields from settings, then `saveKeys` encrypts them into `user_api_keys` | users, user_api_keys | `{message, user}` |

### 2.4 Notes (`routes/notes.ts`, `controllers/notesController.ts`). All routes require auth.
| Method | Path | Validation | Does | Tables | Response |
|---|---|---|---|---|---|
| GET | `/api/notes` | none. Query: `search, tag, category, sort=updated\|created\|title, archived, deleted, snippet, limit(≤500), offset` | Filters by user, `isArchived = (archived==='true')`, `isDeleted = (deleted==='true')`, category, tag (lower-cased name), and `search` as an OR of title, content and tag name `contains`. Paging only when `limit` is set. `snippet=1` cuts content to 400 characters and adds `truncated`. | notes, note_tags, tags, ai_generations | `{notes:[{id,title,content,category,isArchived,isDeleted,createdAt,updatedAt,tags:string[],hasSummary,linkedTodos:[]}], limit?, offset?}` |
| POST | `/api/notes` | `noteSchemas.create` | Creates the note (title defaults to 'Untitled'); `isArchived` is accepted by the schema but **ignored**. Runs `syncTags` and re-fetches. Emits `notes_changed`. | notes, tags, note_tags | 201 `{note}` (includes `linkedTodos`) |
| GET | `/api/notes/:id` | – | `findFirst` scoped to the user | notes + tags, ai_generations, todos | `{note}` or 404 |
| PATCH | `/api/notes/:id` | `noteSchemas.update` | `updateMany` scoped to the user (title, content, category→null if empty, isArchived), then `syncTags` if `tags` is present. **Creates no backup and emits no socket event.** | notes, tags, note_tags | `{message:'Note updated'}` (no note returned) |
| DELETE | `/api/notes/:id` | – | Moves a live note to trash (`isDeleted`, `deletedAt`, `isArchived=false`). If it is already in trash, deletes it permanently. | notes (cascades) | `{message}` / 404 |
| POST | `/api/notes/:id/restore` | – | `isDeleted=false, deletedAt=null` | notes | `{note}` |
| POST | `/api/notes/:id/archive` | – | Toggles `isArchived` (works on trashed notes too) | notes | `{note}` |
| GET | `/api/notes/:id/backups` | – | Versions of a note the caller can read (`noteScope(req,res,'read')`: own note, or a team/Office note under the usual rules), newest first, max 100, metadata plus a 140-char preview (encrypted ones decrypted in JS). Restore (`POST .../revert`), name (`POST /:id/versions`) and rename (`PATCH .../backups/:backupId`) need `noteScope(...,'write')`: space write rights, `teamViewOnly` and Office author/edit rules apply (403 `view_only` / `no_access`); `GET .../backups/:backupId` needs read. A note outside the caller's scope gives 404. Changed on branch `feat-versions` (R10); never run against a database | note_backups | `{backups:[{id,createdAt,size,preview,label,savedBy}]}` |
| POST | `/api/notes/:id/backups/:backupId/revert` | – | Overwrites the note content with the backup (does not back up the current content first) | notes, note_backups | `{note}` |

### 2.5 AI router (`routes/ai.ts`) — mounted at **both** `/api/notes` and `/api/ai`. All routes require auth.
| Method | Path(s) | Validation | Does | Tables | Response |
|---|---|---|---|---|---|
| GET | `/api/ai/link-preview?url=` (the `/api/notes/link-preview` mount is unreachable: the notes `GET /:id` route catches it and returns 404) | url present | Adds `https://` if missing, does a server-side `fetch` with a Chrome User-Agent, then regex-scrapes `<title>` and `og:title/description/image` | – | `{title, description, image, url, domain}`; on error a fallback that echoes the url |
| GET | `/api/ai/ollama/check?url=` | – | `checkOllama(url)`: GET `{url}/api/tags` with a 4 s timeout | – | `{ok, models[], error?}` |
| POST | `/api/notes/block/ai` (client) or `/api/ai/block/ai` | `text`, `command` required | `processTextCommand` (summarize / improve / todo / free-form) | – | `{result: string}` |
| POST | `/api/{notes\|ai}/:id/ai/summary` | note owned; body `title/content` override the stored values | `generateSummary`, then logs `ai_generations` type `summary` | notes, ai_generations | `{summary}` |
| POST | `/api/{notes\|ai}/:id/ai/actions` | same | `extractActionItems`, then logs `action_items` | same | `{action_items: string[]}` |
| POST | `/api/{notes\|ai}/:id/ai/title` | same | `suggestTitle`, then logs `title` | same | `{suggested_title}` (the fallback returns `{title}`) |
| POST | `/api/{notes\|ai}/:id/ai/tags` | same | `suggestTag` (**not logged**) | notes | `{suggested_tag}` |
| POST | `/api/notes/voice-command` (client) or `/api/ai/voice-command` | `transcript` required; `timezone`, `localTime` optional | Sends the voice transcript to the AI and **runs the actions it returns** (§7.5) | todos, notes, tags, note_tags, note_embeddings | `{responseSpeech, needClarification, snooze, snoozeMinutes, actions}` |

### 2.6 AI chat (`routes/aiChat.ts`, `controllers/aiChatController.ts`). Mounted at `/api/ai`; all routes require auth.
| Method | Path | Validation | Does | Tables | Response |
|---|---|---|---|---|---|
| POST | `/api/ai/chat` | `message` required; `mode=create\|append`; `noteId` | The AI plans notes, then the server creates notes. A change to an existing note is applied only to the note the person picked (`mode=append`, `noteId`); a change to any other note is returned as `suggestedUpdate` and NOT applied (PEB-64). #private and Trash notes are not shown to the model (`utils/aiAccess.ts`), and chat on one is refused. Logs `chat` generations. | notes, tags, note_tags, note_backups, ai_generations | `{reply, notes:[note], updatedNote, suggestedUpdate:{noteId,title,appendContent,replaceContent}\|null}` |
| POST | `/api/ai/chat/apply-update` | `noteId`, `appendContent` and/or `replaceContent` | The person said yes to a `suggestedUpdate`: adds to or rewrites that note (not in Trash), keeping the earlier text as a version. No AI call, so no AI limit. | notes, note_backups, ai_generations | `{note}` (404 if gone, 400 if empty, 413 over 200 000 characters) |
| POST | `/api/ai/chat-stream` | same | **SSE**: `data:{chunk}` repeated (the raw JSON text from the model), then `data:{done:true, reply, notes, updatedNote}` or `data:{error}` | same | text/event-stream |
| POST | `/api/ai/smart-intake` | `rawData` required; `template` = auto, meeting, email, project, braindump or syllabus | `analyzeAndOrganize` creates 1 note and N todos linked to it (in a `$transaction`) and logs `smart_intake` | notes, tags, note_tags, todos, ai_generations | `{reply, note, todos}` |
| POST | `/api/ai/smart-intake-upload` | multipart `file`; mimetype must be `application/pdf` or `text/plain` (**multer has no size limit**) | Extracts text with pdf-parse or as UTF-8, then follows the same flow; logs `smart_intake_file` | same | `{reply:'I successfully processed your file! …', note(raw row, no tags), todos}` |

### 2.7 AI Hub (`routes/hub.ts`). Mounted at `/api/ai/hub`; all routes require auth.
| Method | Path | Does | Tables | Response |
|---|---|---|---|---|
| GET | `/api/ai/hub/models` | `listHubModels`: routing setting, Ollama status and installed models (live check if enabled), and whether any cloud AI is configured | users, user_api_keys | `{aiOff, hosted, routing, local:{enabled,ok,url,chatModel,embedModel,models,error}, cloud:[{provider,label,configured,unreadable,model,local?}]}`. `cloud` lists the OpenAI and Gemini server-key slots (only if the server itself has a key) and then the person's own connections (`provider:'conn:<id>'`; `local:true` for a localhost address) |
| POST | `/api/ai/hub/search` | `retrieve(query, {noteIds})`, sources returned without `text` | notes, tags, todos | `{sources, searched:{notes,tasks}, excludedPrivate}` |
| POST | `/api/ai/hub/chat` | **SSE** grounded chat, described in §7.6 | notes, tags, todos, users, user_api_keys | events `sources` → `delta`* → `done{provider,model,local,ms}`, or `consent{provider,message}` / `error{code,message}` |

### 2.7b AI connections (`routes/aiConnections.ts`, `services/aiProviders.ts`). Mounted at `/api/ai/connections`; all routes require auth and are scoped by `userId`.
Every cloud key a person adds is a connection, OpenAI and Gemini included (Gemini through Google's OpenAI-compatible address). Any number of OpenAI-compatible providers per person (table `ai_connections`, migration 015; keys encrypted with `secrets.ts`, never sent back: the app only sees `hasKey` / `unreadable`).
| Method | Path | Does |
|---|---|---|
| GET | `/api/ai/connections` | `{connections, providers (catalog), localAddressesAllowed}` |
| POST | `/api/ai/connections/detect` | Saves nothing. `{key, provider?, baseUrl?}` -> tries the providers a key's prefix suggests (`candidatesFor`), asking each for its model list; first that accepts wins -> `{ok, provider, label, baseUrl, models, suggestedModel}`, or `{ok:false, needsProvider?, error}`. 20 per minute per account (own limiter, not counted as AI use). |
| POST | `/api/ai/connections` | `{provider, key, model, label?, baseUrl?}` -> always a row. Max 20 per account. |
| GET | `/api/ai/connections/:id/models` | The models that connection's key can use now (chat models only; the saved one always included) -> `{models, current, error?}`. Another account's id is a 404. Feeds the model pickers. |
| PUT | `/api/ai/connections/order` | `{ids}` -> the order Peblo tries them in |
| PATCH / DELETE | `/api/ai/connections/:id` | change `enabled`, `model`, `label` / remove |
- Catalog (`PROVIDERS`): openai, gemini, anthropic, openrouter, groq, deepseek, mistral, together, xai, custom. All but Gemini are reached with the `openai` package and a `baseURL`. A named provider's address is fixed on the server; only `custom` takes one from the person.
- **Address rules for `custom`** (`checkBaseUrl`): http(s) only, no user/password, no `?`/`#`, redirects not followed. On a hosted server (`PEBLO_HOSTED=1`) it must be `https` and resolve to a public address (`assertPublicHost`, PEB-24), and is checked again each time it is used (`usableConnections` in `getUserSettings`). On the desktop app any address is fine (LM Studio, vLLM on localhost).
- **Routing.** `providerOrder` puts enabled connections after any server-key OpenAI/Gemini slot, in the person's order (`position`). At start-up `migrateLegacyKeys()` (`services/profile.ts`) moves any old `user_api_keys.openAiKey` / `geminiKey` into connection rows (same encrypted value, model from settings) and empties the old columns; safe to run again. A connection whose address is loopback on the desktop app counts as local: it satisfies "Only on this computer" / "Ask me first" and is never a cloud consent question (`isCloudProvider`). `streamHubChat` accepts `provider:'conn:<id>'`. A connection whose key cannot be read on this install is skipped. Embeddings use a connection whose catalog entry has an `embedModel` (OpenAI, Gemini); Gemini speech-to-text uses a Gemini connection's key.
- Test: `scripts/connections-unit.mjs` (key recognition, address rules) and `scripts/connections-test.mjs` (API, encryption, scoping, cascade, Hub streaming against a fake provider); both run in `npm test`.

### 2.8 Dashboard (`routes/dashboard.ts`). All routes require auth.
| Method | Path | Does | Tables | Response |
|---|---|---|---|---|
| GET | `/api/dashboard/insights` | 11 parallel queries (§6) | notes, note_tags, tags, ai_generations, todos | `{totalNotes, archivedNotes, openTasks, dashboardTasks, recentNotes, topTags, uniqueTagCount, recentAiActivity, aiUsage, activityHeatmap, streakStats, editsThisMonth, categories}` |
| POST | `/api/dashboard/toggle-task` | body `{id, completed}`, no validation; `todo.updateMany({id,userId},{completed})` with no socket emit | todos | `{success, updatedTodo:{id,completed}}` |
| GET | `/api/dashboard/daily-briefing` | §6 | todos, notes | `{greeting, date, stats:{overdue,dueToday,totalActive,completedYesterday}, overdueTasks, todayTasks, recentNotes, tip}` |
| GET | `/api/dashboard/weekly-report` | §6 | todos, notes, tags, ai_generations | `{period:{from,to}, stats:{tasksCreated,tasksCompleted,completionRate,notesCreated,notesEdited,aiUsage}, dailyBreakdown[7], topTags[5]}` |

### 2.9 Todos (`routes/todos.ts`). All routes require auth.
| Method | Path | Validation | Does | Response |
|---|---|---|---|---|
| GET | `/api/todos` | query `date, from, to, priority, completed, noteId` | Filters (date = server-local day bounds on `deadline`; from and to together), ordered by completed asc, deadline asc, createdAt desc. Includes `note{id,title}`. | `{todos}` |
| GET | `/api/todos/today` | – | Open todos with a deadline up to 3 days ahead, split into today, overdue and upcoming (server-local), each sorted by priority | `{todayTasks, overdueTasks, upcomingTasks}` |
| GET | `/api/todos/range?from&to` | both required | Todos with a deadline in the range (for the calendar), all statuses | `{todos}` |
| POST | `/api/todos` | `todoSchemas.create` | Creates the todo, or several when recurring (§5). Checks that `noteId` belongs to the user. Emits `todos_changed`. | 201 `{todo}` |
| PATCH | `/api/todos/:id` | `todoSchemas.update` | Updates owned fields and checks `noteId`. Emits `todos_changed`. | `{todo}` |
| DELETE | `/api/todos/:id` | – | Ownership check, then delete. Emits `todos_changed`. | `{success:true}` |

All of these read and write the `todos` table (and read `notes` when a `noteId` is involved).

### 2.10 Transfer (`routes/transfer.ts`). Mounted at `/api`; all routes require auth.
| Method | Path | Does | Response |
|---|---|---|---|
| POST | `/api/import` | multipart `files[]` (up to 500 files, 500 MB each, held in memory). Fixes latin1 filenames, runs `parseUploads`, creates each note one at a time, `syncTags(tags + 'imported')`, emits `notes_changed`. | `{imported, notes:[{id,title}] (first 50), skippedImages, skippedFiles (first 20)}` |
| GET | `/api/export` | Every non-trashed note as a `.md` file with YAML front matter; archived notes go into `Archive/` | `application/zip`, `peblo-notes-YYYY-MM-DD.zip` |

### 2.11 Study and River (endpoints only; all require auth via a router-level `authenticate`)
- `GET /api/study/mastery`
- `POST /api/study/quiz` (uses `aiService.makeQuiz`)
- `POST /api/study/quiz/:id/answers`
- `GET /api/study/notes/:id/questions`
- `POST /api/river/brief` (uses `meetingBrief` + `sourcesPrompt`)
- `POST /api/river/notes/:id/promises` (uses `findPromises`)
- `GET /api/river/promises`
- `PATCH /api/river/promises/:id`

---

## 3. Auth & security

**Passwords**
- `bcryptjs` hash with cost 12. Length is 8-200 characters, but bcrypt only uses the first 72 bytes.
- No complexity rules, no email verification, no forgot/reset-password flow, no account deletion endpoint.

**JWT** (middleware/auth.ts)
- HS256 via `jwt.sign({sub, email, v: tokenVersion}, JWT_SECRET, {expiresIn:'30d'})`. No refresh tokens.
- `verifyToken` checks the signature and expiry, then loads the user and requires `row.tokenVersion === payload.v`. That costs **one DB query per request**.
- Revocation happens through `tokenVersion`, bumped by change-password and logout-all.
- Secret source:
  - Server: `JWT_SECRET`. In production it must exist, be at least 16 characters and not be the dev default; otherwise it falls back to the dev default.
  - Electron: generates a random 48-byte hex secret per install when `JWT_SECRET` is not configured.

**Rate limits** (middleware/rateLimit.ts)
- A sliding window held in memory per process, keyed on `req.ip`, with cleanup every max(window, 60 s).
- Responses are 429 with a `Retry-After` header.
- Values:
  - login: 10 per 15 min
  - signup: 10 per 60 min (`SIGNUP_RATE_MAX`)
  - change-password: 8 per 15 min
- **No other endpoint is limited**, including AI, link preview, import and hub chat.

**Encryption of API keys** (secrets.ts, services/profile.ts)
- The four key fields are `openAiKey`, `geminiKey`, `groqKey` and `huggingFaceKey`. They are stored in `user_api_keys`.
- Format: AES-256-GCM, `enc:v1:<iv b64>:<tag b64>:<data b64>`.
- The master key is `sha256('peblo-keys:' + (KEY_ENCRYPTION_SECRET || JWT_SECRET || dev default))`.
- If decryption fails, it returns `null` silently.
- Plaintext legacy values pass through decrypt unchanged and are encrypted at boot.
- Keys are **decrypted and returned to the client** inside `user.settings` by `loadProfile` (signup, login, GET/PUT profile).

**Data isolation**
- Every controller scopes queries with `userId: req.user.id`. Styles used:
  - `findFirst({id, userId})`
  - `updateMany` / `deleteMany` with userId
  - nested `note: {userId}` for backups
  - Prisma 6 extended unique `update({where:{id,userId}})` in the voice actions
- Tags are per user.
- Sockets join a per-user room.
- **Team rooms (R11, feat-realtime, never run against a DB):** on connect a socket also joins `space:<id>` for every space its person can read (`utils/spaceRooms.ts` `syncSocketRooms`, same SQL conditions as `spaceRole`/`orgAccess`: space member, active org member, guest not expired, nothing closed). Rooms are re-synced after membership changes (invite/join-link accept, org member patch/remove/leave, `PUT /spaces/:id/members/:userId`, org/space create via `refreshUserRooms`; space leave via `kickFromSpace`; space close via `refreshSpaceRoom`) and every 5 minutes (`startRoomRefresh`). `utils/notify.ts` has `emitSpace` and `emitUserAndSpace`; `notify(req, ...)` also reaches the space room when `noteScope()` verified a space for the request (it sets `req.peerSpace`). Payload is `{ space }` (null = Personal), never text. Write paths covered: notesController, notesAccess, notesMove, teamShare, teamTalk, todosController. Not covered: share.ts and transfer.ts (Personal only).
- Two weak spots:
  - `revertBackup` checks note ownership first, then compares the backup's `noteId`, so it is safe.
  - `toggleTask` with a missing `id` matches **all of the user's todos** (bug B3), but only that user's own data.

**Account endpoints:** signup, login, change-password, logout-all, GET/PUT profile (email can be changed without re-entering the password).

---

## 4. Notes

**CRUD:** see §2.4.
- `createNote` uses `title||'Untitled'`, `content||''`, `category||null`, emits `notes_changed`, and returns the full note.
- `updateNote` is a partial `updateMany` that returns only a message. The client must keep its own state.

**Tags** (`syncTags`, notesController.ts:9-56)
1. Normalises the input (trim, lower-case, dedupe, sort) and compares it with the current tags; if identical, it stops.
2. Deletes all note_tag links.
3. Fetches the existing tags in bulk and `createMany`s the missing ones, then re-fetches them.
4. `createMany`s the links.

Orphan tags are never removed. `aiChatController` has its own N+1 copy of `syncTags` (aiChatController.ts:22-33).

**Versions/backups**
- `note_backups` rows are written **only** by the AI chat update path (`applyNoteUpdate` in `aiChatController.ts`, used by `/ai/chat`, `/ai/chat-stream` and `/ai/chat/apply-update`; the last 5 are kept).
- Normal PATCH saves never create versions.
- `/ai/chat` keeps the newest 5 backups (aiChatController.ts:112-121). `/ai/chat-stream` does **not** prune (aiChatController.ts:230-232), so its backups grow without limit.
- Revert overwrites the note with no safety backup.

**Archive, trash, restore**
- `archive` toggles `isArchived`.
- `DELETE` is two-stage: soft delete to trash (which also un-archives), then hard delete from trash.
- `restore` clears `isDeleted`.
- `deletedAt` is written but never read: there is no auto-purge of trash.

**Search**
- Prisma `contains` (MySQL `LIKE %q%`) on `title` (TEXT), `content` (LONGTEXT) and tag names, OR'd together.
- Case-insensitivity depends on the collation.
- No full-text index, no ranking. It uses the same archived/deleted filters, so searching only covers the current view.

**Pagination:** optional `limit` (≤500) and `offset`. With no `limit`, the server returns **all notes with full content** (a deliberate choice, explained in a comment).

**Snippets:** `snippet=1|true` cuts content to 400 characters and sets `truncated`.

**Link preview:** server-side fetch plus regex scraping (aiController.ts:246-299). There is no timeout, no size cap and no private-IP block (see risk S2).

**Import** (`services/importService.ts`, `/api/import`)
- Formats: `.md`, `.markdown`, `.txt`, `.csv` and `.zip` (nested zips up to depth 4).
- Skipped: dotfiles and `__MACOSX/`. Images are ignored; references to them are stripped and counted in `skippedImages`. Every other extension goes to `skippedFiles`.
- **No PDF, DOCX or HTML import here.** PDF is only handled by `/ai/smart-intake-upload` through pdf-parse.
- Markdown parsing:
  - BOM and CRLF are normalised.
  - YAML front matter keys `tags/tag/keywords` (inline or list form), `title`, and `created/date`.
  - A leading `# H1` becomes the title.
  - Notion property lines (`Key: value` directly under the title): tags/labels/category become tags, created/date set `createdAt`, and other properties are kept as bold `**Key:** value` lines.
  - Notion's 32-hex IDs are stripped from filenames.
  - Relative image embeds are removed. Links to `.md`/`.csv` pages become plain text.
  - Title is capped at 300 characters, tags at 20.
- CSV: an RFC-4180 parser turns the file into one note containing a Markdown table, tagged `table`. Of `DB.csv` and `DB_all.csv`, only `_all` is kept.
- Notes are inserted one at a time, outside any transaction, and keep their `createdAt` when the source had one.

**Export:** `buildMarkdownExport` builds an in-memory AdmZip.
- Filenames are sanitised and de-duplicated (`Title (2).md`).
- Front matter: `title`, `tags`, `created`, `updated`. The body starts with `# Title`.
- Archived notes go into `Archive/`. Trashed notes, todos, backups and AI generations are not exported.

---

## 5. Todos

**Fields** (`todos` table):
- `id`, `userId`, `text`, `completed` (column `is_completed`), `priority` ('high'/'medium'/'low', stored as a free string)
- `deadline` DateTime?, `todoTags` JSON array (column `tags`), `noteId` (column `linked_note_id`, SetNull on note delete)
- `startTime` / `endTime` as free strings like "09:00", `recurrence` ('none'/'daily'/'weekly'/'monthly'/'yearly')
- `createdAt`, `updatedAt`

**Recurrence**
- Handled by **creating every occurrence up front** at creation time (todosController.ts:139-168): daily ×30, weekly ×12, monthly ×12, yearly ×5. This only happens when a deadline is set.
- There is no series ID. Editing or deleting one occurrence never affects the others, and changing `recurrence` in PATCH only relabels that row.
- Monthly uses `setMonth(+1)`, so a Jan 31 start overflows into March.
- The returned todo is looked up again by `text + first deadline` (todosController.ts:183).

**Reminders:** none on the server. There is no scheduler or notification job; any reminders live in the client or Electron.

**Natural-language parsing:** not done for normal todo creation (the body must already be structured). NL-to-task happens only through AI:
- smart intake (`deadline` YYYY-MM-DD, times HH:MM, relative dates resolved against the server's "today")
- voice commands (`CREATE` / `RESCHEDULE` with an ISO `newDate`)
- River promises

**Dates**
- `new Date(string)` is used everywhere without validation. An invalid string becomes an Invalid Date and a Prisma error (500).
- Day boundaries (`?date=`, `/today`, briefing) use the **server's** local time zone. `users.timezone` is stored but never used.

**Socket events**
- `todos_changed`: create, update and delete todo; voice actions COMPLETE, RESCHEDULE, CREATE.
- `notes_changed`: createNote, import, voice CREATE_NOTE.
- **Not emitted** for: dashboard toggle-task, smart intake (note and todos), `/ai/chat` and `/ai/chat-stream` note creations or updates, note PATCH, delete, restore, archive, revert. (The comment at index.ts:94 says sockets exist "after AI creates notes/tasks", but the chat and intake paths do not emit.)

---

## 6. Dashboard & activity stats

### `GET /insights` (dashboardController.ts:12-150)
| Metric | How it is computed |
|---|---|
| `totalNotes` | count of notes that are neither archived nor deleted |
| `archivedNotes` | count of archived, non-deleted notes |
| `openTasks` | count of todos with `completed=false` |
| `dashboardTasks` | 10 most recently **created** todos (any status) with `note{id,title}` |
| `recentNotes` | non-deleted notes (archived included) updated in the last 7 days, top 5 by updatedAt, with tag names |
| `topTags` / `uniqueTagCount` | every note_tag link on non-deleted notes is loaded, counted per tag name in JS, top 10 by note count; distinct tag-name count |
| `recentAiActivity` | last 5 `ai_generations` rows, labelled: summary → "Summarized…", action_items → "Extracted actions…", **everything else** → "Suggested title for…" (wrong for chat and smart_intake) |
| `aiUsage` | `{total: count, byType: groupBy(type)}` |
| `categories` | groupBy category over active notes with a non-null category |
| `activityHeatmap` | see below |
| `streakStats` | `{current, longest, activeDays, mostActiveDay, recentActiveDates[4]}` |
| `editsThisMonth` | sum of day totals whose key falls in the current local month |

**How the activity data is built** (utils/activityStats.ts)
- **Input:** notes with `updatedAt` within 365 days, **trashed notes included**, only `createdAt` and `updatedAt`.
- **`buildDailyActivity`:** each note adds +1 to its creation day, and +1 to its last-update day if that is a different day. Only the *last* update of each note is visible; there is no real edit log. A note created more than a year ago but edited recently adds an old `created` day too.
- **Faked "today":** the controller forces `dayMap[todayKey].total = 1` when today has no activity (dashboardController.ts:111-118). This is made-up activity that keeps the streak alive.
- **`buildYearHeatmap`:** starts 364 days back, rewinds to a Sunday, walks to today, and chunks the days into weeks of 7 cells `{date, created, updated, total, dayOfWeek}`.
- **`calculateStreakStats`:**
  - longest: longest run of consecutive active date keys.
  - current: counts back from today, or from yesterday if today is inactive.
  - mostActiveDay: weekday with the highest total.
  - recentActiveDates: last 4 active days.
- **`toDateKey`:** sets local midnight and then calls `toISOString()`. In any UTC+ zone (India is +5:30) this gives the **previous** calendar date. `todayKey` in the controller uses the UTC date instead, so the two disagree (bug B6).

### `GET /daily-briefing` (dashboardController.ts:173-233)
- `completedYesterday`: todos with completed=true and `updatedAt` in [yesterday 00:00, today 00:00). This uses `updatedAt` as a stand-in for completion time.
- `totalActive`: count of open todos.
- `overdueTasks`: open todos with deadline before today 00:00, **take 10**. `stats.overdue` is that array's length, so it is **capped at 10**.
- `todayTasks`: open todos due today, sorted high → medium → low.
- `recentNotes`: active notes updated since yesterday 00:00, top 5.
- `greeting`: morning before 12, afternoon before 18, evening otherwise, by the server's clock.
- `date`: en-US long format.
- `tip`: one of 8 fixed tips, chosen by day number.

### `GET /weekly-report` (dashboardController.ts:251-329)
- Window: now minus 7 days.
- `tasksCreated`: count.
- `tasksCompleted`: completed todos with `updatedAt` in the window.
- `notesCreated`: count, trashed included.
- `notesEdited`: notes with `updatedAt` in the window, trashed included. A newly created note also counts as "edited".
- `aiUsage`: count of generations in the window.
- `completionRate = round(completed / (completed + allOpen) × 100)`.
- `dailyBreakdown`: 7 local-date buckets of tasksCompleted and notesEdited.
- `topTags`: top 5 tags of the edited notes.
- `period`: from/to as UTC ISO dates.

### `POST /toggle-task`
`updateMany({id, userId}, {completed})` with no validation and no socket event.

---

## 7. AI

### 7.1 Providers & models (services/aiService.ts)
| Provider | Client | Chat model | Embedding model | Key source |
|---|---|---|---|---|
| OpenAI | `new OpenAI({apiKey})` | `gpt-4o-mini` (fixed) | `text-embedding-3-small` | User's decrypted `openAiKey`. Otherwise, unless `settings.forceCustomModels===true`, the server's `OPENAI_API_KEY` (ignored if it contains "your-openai"). Lines 33-43. |
| Gemini | `GoogleGenerativeAI(key)` | `GEMINI_MODEL` or `gemini-2.5-flash` | `text-embedding-004`, falling back to `gemini-embedding-001` | User's `geminiKey`. Otherwise, unless forceCustomModels, `GEMINI_API_KEYS`/`GEMINI_API_KEY` (comma list, but **only the first key is used**). Lines 62-74. |
| Ollama (local) | OpenAI SDK with `baseURL={ollamaUrl}/v1`, apiKey 'ollama', 5 min timeout | `settings.ollamaModel` or `llama3.2` | `settings.ollamaEmbedModel` or `nomic-embed-text` | Only when `settings.ollamaEnabled===true`. URL is `settings.ollamaUrl` or `http://127.0.0.1:11434`. |
| Groq, HuggingFace | – | – | – | The keys are stored and encrypted but **never used** (dead). |

### 7.2 Routing
`settings.defaultAiModel` controls the order (`providerOrder`, lines 81-89):

| Setting | Provider order |
|---|---|
| `auto` (default) | openai → gemini → ollama |
| `openai` | openai → gemini → ollama |
| `gemini` | gemini → openai → ollama |
| `ollama` (Local only) | ollama only |
| `ask` | ollama only for background features |

**Hosted servers (`PEBLO_HOSTED=1`).** There is no AI on the person's computer, so `routingOf(user)` turns a stored `ollama` or `ask` into `auto`, and a per-feature pin of `local` is ignored. `providerOrder`, `streamHubChat` and `listHubModels` all go through `routingOf`. `GET /api/ai/hub/models` returns `hosted: true`; the Connections screens (Soft, River, Orbit) then hide the routing choices, the Local AI card and the Model store and show only cloud keys. The stored setting is not rewritten, so the same account on the desktop app still honours `ollama` / `ask`. Because a hosted account that had picked "Only on this computer" now sends notes to its connected cloud key (or to the server's `SERVER_AI_KEYS`), the hosted screen says so in plain words.

**`runWithCascade`** (lines 106-142)
- Loads the user and keys on every call and builds new SDK clients each time.
- Tries the providers in order. Failures are logged and the next provider is tried.
- If no provider is configured: throws `LOCAL_ONLY` (400) when the order is local-only but a cloud key exists, otherwise `NO_AI_KEY` (400).
- If all providers fail: a generic Error (500).

**Helpers**
- `completeJSON`: OpenAI `response_format: json_object` with "Respond with valid JSON only." added; Gemini `responseMimeType: application/json`.
- `parseJSONLoose`: strips code fences, then takes the outermost `{…}`.
- `completeText`: plain-text completion.

### 7.3 Feature prompts
| Feature | Function | Prompt essence | Output | On failure |
|---|---|---|---|---|
| Summary | `generateSummary` | "elite executive assistant… extremely dense"; 2-3 sentence summary of title and content | `{summary}` (Gemini enforces `responseSchema`) | mock `{summary:'AI is not available…'}`, still logged as a summary |
| Action items | `extractActionItems` | "ruthless project manager… every implicit or explicit task" | `{action_items:[]}` | `{action_items:[]}` |
| Title | `suggestTitle` | "expert copywriter… 3-8 words" | `{suggested_title}` | `{title:'Untitled Note'}` (different key) |
| Tag | `suggestTag` | a single one-word tag | `{suggested_tag}` | `{suggested_tag:'Note'}` |
| Block command | `processTextCommand` | `summarize` (1-2 sentences), `improve` (copyedit), `todo` ("- " list), anything else becomes `"${command} the following text"` | string | **fake placeholder text** ("Summary: This is a placeholder…", "- Task 1: Check text content…") |
| Chat / plan notes | `chatPlanNotes` | "$10,000/month AI Chief of Staff"; heavy Markdown, 2-5 tags, a category; may `updateNote.appendContent/replaceContent` an existing note by ID taken from the context list (up to 20 recent titles). In append mode the target note's full content is included. | `{reply, notes:[{title,content,category,tags}], updateNote}` | creates a **placeholder note** "(Fallback)… AI generated response disabled due to API limits" |
| Chat stream | `chatPlanNotesStream` | Same prompt. Picks the **first configured** provider with no cascade. Writes the SSE header itself and streams the raw JSON chunks. | same | a parse failure gives reply "Error parsing AI response" |
| Smart intake | `analyzeAndOrganize` | "AI Chief of Staff" with a template hint (auto, meeting, email, project, braindump, syllabus); extracts every task with priority, YYYY-MM-DD deadline relative to the server's "today", start/end times and tags; the note gets title, content, category from a fixed list, and 3-6 tags | normalised `{reply, note, tasks}` | a raw note "Imported Data" tagged imported and needs-review |
| Voice | `processVoiceCallCommand` | transcript, every open task `{id,text,deadline}`, every non-archived note `{id,title}`, user local time and time zone; allowed actions COMPLETE, RESCHEDULE, CREATE, SNOOZE, CREATE_NOTE, READ_NOTE, CLARIFY | `{actions[], needClarification, responseSpeech}` | a spoken error message |
| Verbal summary | `generateVerbalNoteSummary` | 1-2 sentences, speech-friendly, no Markdown | string | "The note content could not be read." |
| Embedding | `generateEmbedding` | follows the chat cascade order | number[] | `[]` |
| Smart intake extract | `extractSmartIntake` | title, category, summary, actionItems | – | **dead code (never called)** |
| Quiz (study) | `makeQuiz` | notes cut to 2500 characters each and 12 000 total; N four-option questions with answer index, explanation, concept and source note number; the result is sanitised | `QuizQuestion[]` | throws |
| Promises (river) | `findPromises` | commitments with owner and due date (resolved against the note's date), at most 6 | `Promise_[]` | throws |
| Meeting brief (river) | `meetingBrief` | 3-5 points with `cite` arrays, built from `sourcesPrompt` | `{points}` | throws |

### 7.4 Logging to `ai_generations`
Rows are written for:
- `summary`, `action_items`, `title` (aiController)
- `chat`, with `{source:'dashboard_chat', message}` or `{source:'dashboard_chat_update'}`
- `smart_intake` and `smart_intake_file`, with `{source, tasksExtracted}`

Not logged: tags, block commands, voice, hub chat, quiz, promises, brief. Since `noteId` is required in the table, features that are not tied to a note cannot be logged. The `result` column holds `JSON.stringify(result)`. The only consumers are `hasSummary` on notes and the dashboard counts.

### 7.5 Actions the AI can take on user data (all scoped to the user)
**Voice command** (aiController.ts:115-222). Actions run in order, with no transaction:
- `RESCHEDULE`: `todo.update({where:{id,userId}}, {deadline:new Date(newDate)})`
- `COMPLETE`: sets `completed: true`
- `CREATE`: a new todo, priority medium
- `CREATE_NOTE`: note with category "Voice Notes", tags, and a fire-and-forget `saveEmbeddingForNote`
- `READ_NOTE`: generates a verbal summary into `responseSpeech`
- `SNOOZE`: returns `snooze`/`snoozeMinutes`

An unknown or hallucinated `taskId` throws P2025 (404) after the earlier actions already ran.

**Chat (`/ai/chat`, `/ai/chat-stream`)**
- Creates any number of notes.
- Appends to or **fully replaces** the content of any note the user owns, by AI-chosen ID; a backup is written first.

**Smart intake:** creates one note and N todos.

**AI Hub chat:** read-only. There is **no tool or function calling anywhere**; the "tools" are the JSON action schemas above, run by the controllers.

### 7.6 Streaming (SSE)
**`/api/ai/hub/chat`** (routes/hub.ts:34-90)
1. Keeps the last 12 user/assistant messages and requires the last one to be from the user.
2. Writes the SSE header immediately.
3. `AbortController` is aborted when the response closes.
4. `retrieve()` runs, then a `sources` event is sent.
5. The system prompt: Peblo assistant, today's date (en-IN, server time zone), cite as [n], fall back to general knowledge, concise Markdown.
6. Sources are appended to the last user message.
7. `streamHubChat` then sends `delta` events, and finally `done`.

**`streamHubChat` routing** (aiService.ts:983-1079)
- Order:
  - an explicit `opts.provider` → that provider only
  - routing `ask` → `['ollama']`, or `['ollama','openai','gemini']` when `allowCloud`
  - otherwise `providerOrder`
- Routing `ollama` with a cloud provider in the order and no `allowCloud` → `LOCAL_ONLY` error.
- Routing `ask` with an explicit cloud provider and no `allowCloud` → `CLOUD_CONSENT`.
- Nothing available under `ask` but a cloud key exists → `CLOUD_CONSENT`. Local AI failed under `ask` → `CLOUD_CONSENT`.
- It falls through to the next provider only if nothing has been streamed yet ("don't mix two models' answers").
- `opts.model` overrides the Gemini model, or the OpenAI/Ollama model when that provider was chosen explicitly (Ollama always).

**`/api/ai/chat-stream`:** streams `{chunk}` events holding raw JSON fragments, then a final `{done…}`. There is no close or abort handling, so notes are still created if the client disconnects.

### 7.7 Retrieval / RAG (services/retrieval.ts)
- **"Phase 1": keyword search only; there is no vector search.** The `note_embeddings` table is written (voice notes only) but **never read**.
- Every non-deleted note of the user is loaded (full content, plus tags), along with every open todo.
- Notes tagged `#private` are excluded and counted in `excludedPrivate`.
- Tokens: lower-case Unicode letters/numbers, longer than 2 characters, minus about 70 stopwords.
- Note score per token: +4 if the title contains it, plus min(substring hits in body+tags, 5). A note attached through `noteIds` gets +1000.
- The top max(5, number attached) notes with score > 0 are kept; ties go to the most recently updated.
- Each note source has `text` = content cut to 1800 characters, plus a snippet of about 170 characters around the first hit.
- Up to 3 open tasks with score > 0, **not sorted by score**.
- If the query matches `TIME_WORDS` (today, week, exam, monday…), an "agenda" source is added: open tasks due within the next 7 days (overdue included), up to 12.
- `sourcesPrompt` numbers the sources `[n]` and cuts the whole block to 7000 characters.

---

## 8. Hub routes: what exists vs stubs
- **What exists:** `/models`, `/search` and `/chat` (§2.7, §7.6). "Connections" means the routing setting, the Ollama URL/models and the OpenAI/Gemini keys, which are saved through `PUT /api/profile` settings. `/api/ai/ollama/check` tests a URL.
- **Not built:** OAuth integrations (Google Calendar, Notion, Drive and so on), webhooks, sync, and use of the Groq or HuggingFace keys. Notion and Obsidian are covered only by the one-off zip import. Embeddings / "hybrid search" are mentioned as future work (retrieval.ts:3-6, which points to `docs/04-ai-hub.md`). Hub chat history lives only in the client's localStorage (`client/src/hooks/useHubChat.js:10`).

---

## 9. Profile service (services/profile.ts)
- `KEY_FIELDS = ['openAiKey','geminiKey','groqKey','huggingFaceKey']`.
- `loadProfile(userId)`:
  - Selects id, name, email, jobTitle, bio, timezone, settings and apiKeys.
  - Merges the **decrypted** keys into `settings` and removes any key that is empty or cannot be decrypted.
  - Never returns `passwordHash`, `tokenVersion` or timestamps.
- `saveKeys(userId, incoming)`: for each key field present, encrypts it (an empty value becomes NULL), then upserts `user_api_keys`.
- `protectExistingKeys()`: boot-time migration (§1).
- Settings keys the server reads: `defaultAiModel`, `forceCustomModels`, `ollamaEnabled`, `ollamaUrl`, `ollamaModel`, `ollamaEmbedModel`. Everything else in settings is opaque client state, with no schema and no size limit beyond the 10 MB body limit.

---

## 9b. Email verification (migration 019)
- Table `email_tokens` (kind `verify` | `change`, only the sha256 of a random 32-byte token, 24h expiry, single use; a newer link of the same kind replaces the older). `users.emailVerifiedAt` marks a confirmed address.
- Routes (routes/auth.ts): `POST /api/auth/send-verification`, `POST /api/auth/verify-email`, `POST /api/auth/cancel-email-change`. Signup also sends the link.
- services/emailAccount.ts = token logic; services/mailer.ts sends mail with no extra package: SMTP over implicit TLS (465, AUTH LOGIN), Resend HTTPS, or `MAIL_OUTBOX=<file>` for tests.
- Env: `SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS` (Gmail: App Password) or `RESEND_API_KEY`; `MAIL_FROM`; `PUBLIC_URL`. No mail configured: the app says so and an email change applies immediately (unconfirmed). Mail configured: a change waits for the link sent to the new address and the old address gets a notice.
- `GET /api/profile` adds `emailVerified`, `pendingEmail`, `mailReady`.
- Test: `scripts/account-test.mjs` (29 checks incl. a fake TLS SMTP server), part of `npm test`.

## 10. Bugs, security risks, performance issues, dead code (most severe first)

### Critical / High
1. **S1. The architecture shares one MySQL database across desktop installs, and each install holds the DB credentials.**
   - Each Electron install reads `DATABASE_URL` from a local `.env` and runs its own server against "a MySQL server shared by every account" (db.ts:7-9, electron/main.cjs:136-161).
   - Anyone with the app's `.env` can connect directly and read or modify **every user's** notes, password hashes and encrypted keys, bypassing all `userId` scoping.
2. **S2. SSRF through the link preview** (aiController.ts:246-262).
   - Any signed-in user (signup is open) can make the server GET any URL: `http://169.254.169.254/…`, `localhost` services, intranet hosts.
   - The scraped `<title>` and `og:*` values are returned, so this is a read primitive.
   - There is no timeout, no response-size cap and no scheme or IP allow-list, and redirects are followed. Severe on a hosted deployment.
3. **S3. SSRF through Ollama URLs.**
   - `/api/ai/ollama/check?url=` fetches `{url}/api/tags` and reports the HTTP status, which works as a port scanner (aiService.ts:200-210).
   - `settings.ollamaUrl` is used as the OpenAI `baseURL`, so on a hosted server a user can point AI calls (with their note content) at internal hosts (aiService.ts:53-56).
   - Also a design flaw: on a hosted server, `127.0.0.1:11434` means the server, not the user's machine.
4. **S4. Encryption keys differ per install, so API keys silently disappear.**
   - Electron generates a random `JWT_SECRET` per install (main.cjs:150-158). `KEY_ENCRYPTION_SECRET` falls back to it (secrets.ts:11).
   - With the shared DB, a key saved on machine A cannot be decrypted on machine B. `decryptSecret` returns `null` silently (secrets.ts:39-41), so AI shows "no key".
   - Tokens are also only valid on the install that issued them.
5. **B1. Operator's server keys are open to anyone.** `OPENAI_API_KEY` / `GEMINI_API_KEY` are used for every user without their own key (aiService.ts:37-40, 70-73). With open signup and **no rate limit on any AI endpoint**, anyone can spend the operator's quota.
6. **S5. Unbounded uploads in memory (denial of service).**
   - `/api/ai/smart-intake-upload` uses `multer.memoryStorage()` with **no limits** (routes/aiChat.ts:7).
   - `/api/import` allows 500 files × 500 MB in memory (transfer.ts:11).
   - AdmZip expands entries and nested zips (up to depth 4) fully in memory, a zip-bomb risk (importService.ts:328-334).
   - pdf-parse runs on attacker-supplied PDFs, and the mimetype check trusts the client (aiChatController.ts:371-378).
7. **B2. Validation errors probably return 500, not 400.**
   - The lockfile has Zod 4.6.5. In Zod 4, `ZodError` exposes `.issues`; the `.errors` alias that `validate.ts:21` relies on no longer exists.
   - So `.errors.map` throws inside the catch block, and every validation failure on notes or todos (for example `category: null`) becomes a 500 with "Cannot read properties of undefined (reading 'map')".
   - Verify by running it; the fix is `error.issues`.
8. **B3. `POST /api/dashboard/toggle-task` without `id` updates every todo of the user.** There is no validation (dashboardController.ts:155-161). Prisma treats `id: undefined` as "no filter", so `{completed:true}` alone marks all of the user's todos done. A missing `completed` returns success without changing anything.

### Medium
9. **S6. Rate limiting is weak** (rateLimit.ts:19).
   - It is per process and in memory, keyed on `req.ip`.
   - Behind a proxy without `TRUST_PROXY`, all users share one IP, so 10 logins per 15 min applies to everyone together.
   - With `TRUST_PROXY=true`, `X-Forwarded-For` can be spoofed to get around it.
   - Successful logins also count. There is no per-account lockout.
10. **S7. Account enumeration.** Signup answers 409 "already exists" (auth.ts:31-32). Login skips bcrypt for unknown emails, which leaks through timing (auth.ts:49-50).
11. **S8. Decrypted API keys are sent to the client** on every login, signup and profile call (profile.ts:19-22). Any XSS in the renderer leaks them, which undercuts the encryption at rest.
12. **S9. Raw error messages reach the client.** `errorHandler` returns `err.message` for 500s (errorHandler.ts:17-18), which can include Prisma and internal error text. CORS rejections also come back as 500.
13. **S10. Prompt-injection blast radius.**
    - The voice and chat endpoints run AI-chosen destructive actions: complete or reschedule any task, **replace the content of any note** (aiChatController.ts:143-145).
    - Note content pulled into prompts (append mode, READ_NOTE) can steer those actions.
    - A backup exists only for chat replacements.
14. **S11. `#private` is honoured only by Hub retrieval.**
    - Voice sends every non-archived note title, **trashed ones included**, to cloud providers (aiController.ts:128-131).
    - Chat sends the 25 most recent titles, trashed included (aiChatController.ts:66-70, 187-192). The AI can then pick a trashed note to update.
15. **S12. "Local only" is enforced on trust.** `allowCloud: true` from the client gets past `routing==='ollama'` (aiService.ts:1008), so the server does not really guarantee "notes stay on this device".
16. **B4. Failed AI calls look like real results.**
    - Summary failures return the mock text, which is logged as a `summary` generation and sets `hasSummary=true` (aiService.ts:246-248, aiController.ts:24-31).
    - `processTextCommand` returns fabricated placeholder tasks or summaries (aiService.ts:763-768).
    - `chatPlanNotes` failure **creates a junk note** (aiService.ts:392-403).
    - `NO_AI_KEY` is swallowed by these functions.
17. **B5. The title fallback uses a different key.** The fallback returns `{title}` while the real result is `{suggested_title}` (aiService.ts:12 vs 536).
18. **B6. Activity dates are off by one in UTC+ zones (India included), and today is faked** (activityStats.ts:1-5, dashboardController.ts:111-118).
    - `toDateKey` (local midnight → `toISOString`) shifts every key back one day.
    - `todayKey` uses the UTC date, so the two disagree.
    - The forced `total=1` for "today" invents activity, which inflates the streak, `activeDays` and `editsThisMonth`.
    - The heatmap includes trashed notes and only each note's latest update.
19. **B7. The briefing's overdue count is capped at 10** because of `take: 10` (dashboardController.ts:191-196, 220).
20. **B8. Server time zone is used for user dates.** Day boundaries in todos, briefing, greeting, the smart-intake "today" and the hub date use the server's clock. On a hosted (UTC) server the user's "today" is wrong. `users.timezone` is unused.
21. **B9. Unvalidated dates cause 500s.** Todo `deadline`, voice `newDate` and smart-intake dates rely on `new Date(str)` (todosController.ts:139, aiController.ts:146). Invalid strings make Prisma throw. In voice, earlier actions have already been applied by then (no transaction).
22. **B10. Recurrence is copy-based, with monthly overflow.** Occurrences are materialised with no series ID, monthly dates overflow (setMonth on day 31), and later edits never regenerate the series (todosController.ts:139-168).
23. **B11. Backup and trash housekeeping is inconsistent.**
    - The chat-stream path never prunes backups (aiChatController.ts:230). The non-stream path keeps 5.
    - Ordinary edits make no versions. Revert does not back up the current content.
    - Trash is never auto-purged (`deletedAt` unused).
24. **B12. Missing socket events.** No `notes_changed` / `todos_changed` after AI chat, smart intake, toggle-task, or note update/delete/restore/archive (§5). Other windows go stale.
25. **B13. Duplicate and shadowed routes.**
    - `ai.ts` is mounted at both `/api/notes` and `/api/ai` (index.ts:63-65). This doubles the API surface: `/api/ai/:id/ai/summary` and `/api/notes/voice-command` both exist.
    - `GET /api/notes/link-preview` and `/api/notes/ollama/check` are shadowed by `GET /api/notes/:id` and return 404.
    - Requests that fall through run `authenticate` (one DB query) twice: `/api/ai/chat*`, `/api/ai/smart-intake*`, `/api/notes/block/ai`, `/api/notes/voice-command`, `/api/notes/:id/ai/*`.
    - Unmatched `/api/*` paths return 401 (from transfer's router-level auth) or Express's HTML 404, not JSON.
26. **B14. Hub model override leaks across providers.** `opts.model` is applied to Gemini even when it was meant for Ollama (aiService.ts:1037). For example, if the routing falls through to Gemini with `model:'llama3.2'`, the call fails.
27. **B15. `chatPlanNotesStream` has no fallback** (aiService.ts:435). It uses only the first configured provider, and it streams raw JSON fragments to the UI.
28. **B16. `getNotes` crashes on an array `tag` query.** `?tag=a&tag=b` makes `tag.toLowerCase` throw, giving a 500 (notesController.ts:104). Also, `isArchived` is accepted by the create schema but ignored (notesController.ts:191).
29. **S13. Sockets survive sign-out.** They are authenticated only at the handshake, so after logout-all or a password change, open sockets keep receiving events until they reconnect.
30. **S14. Profile fields are unvalidated.** `jobTitle`, `bio`, `timezone` and `settings` are not type- or size-checked (profileController.ts:15-46). Changing the email does not require the current password.
31. **S15. Password length mismatch.** Passwords longer than 72 bytes are silently truncated by bcrypt while 200 characters are allowed (auth.ts:28-29).

### Performance
32. **P1. Retrieval loads everything.** Every hub chat or search loads **all notes' full content** and all open todos into memory and scans them with `split()` (retrieval.ts:75-85). Substring matching means "cat" matches "category".
33. **P2. Notes list returns full content.** `GET /api/notes` with no `limit` returns every note in full. Search is `LIKE %q%` on LONGTEXT with no full-text index.
34. **P3. Voice prompts include everything.** Voice sends all open tasks and all notes into the prompt, so token use grows with the account. `/insights` loads every note_tag link and a year of notes to count in JS.
35. **P4. Per-call overhead.**
    - Every AI call re-reads the user and keys and builds new SDK clients.
    - The cascade waits for each provider to fail in turn: the OpenAI default timeout is about 10 min, Ollama is 5 min, Gemini has none.
    - `verifyToken` hits the DB on every request (doubled on the routes in B13).
36. **P5. Import is slow and unsafe for large sets.** It creates notes one at a time, each followed by about 4-6 tag queries, with no transaction. Partial failure leaves a half-finished import. `protectExistingKeys` scans all users on every boot.
37. **P6. Tag concurrency.** Concurrent `syncTags` calls can race on `tags (userId, name)` and get a P2002 (409). Orphan tags are never cleaned up.

### Dead code / inconsistencies
38. **Unused code:**
    - `extractSmartIntake` (aiService.ts:799) is never called.
    - `note_embeddings` / `generateEmbedding` / `saveEmbeddingForNote` are written for voice notes only and never read. Embeddings from different providers would also have different dimensions.
    - `groqKey` and `huggingFaceKey` are never used.
    - Only `GEMINI_API_KEYS[0]` is used; there is no key rotation.
    - `getMockResponse` ignores its parameters.
39. **Duplicated logic:** `syncTags` and `formatNote` exist in both controllers (the aiChat copy is N+1). The chat and chat-stream controllers repeat about 80 lines.
40. **Wrong labels and odd names:** `recentAiActivity` labels any type that is not summary or action_items as "Suggested title" (dashboardController.ts:89-97). The type is named `Promise_`.
41. **Leftover comments:** "Send to Gemini" (aiController.ts:134) is wrong because the call goes through the cascade. "createManyAndReturn" comments remain.
42. **Response shapes are inconsistent:**
    - `PATCH /notes/:id` returns only a message, while PATCH todo returns the todo.
    - `smart-intake-upload` returns a raw note row (no tags or hasSummary), while `smart-intake` returns a formatted note.
    - `createNote` includes `linkedTodos`; chat-created notes do not.

## Notes list shape and search (branch `feat-versions`, R34/R35; never run against a database)
- `GET /api/notes?fields=list` returns the light shape: the usual row fields plus `snippet` (first 140 readable characters), `wordCount`, `hasPics`, `light:true`; no `content`, `aiGenerations`, `_count`. `taskCount`, `hasSummary`, tags, meta and Office `owner/access` stay. The server still reads and decrypts each body to make the snippet, so the saving is payload, not CPU. Without `fields` the shape is unchanged (Orbit, River, Home, AI Hub). `?snippet=1` (400-char content) still exists.
- Search: fewer than 2 characters returns `{notes: []}`. Title (a plain column) and tag names are matched in SQL first; bodies (encrypted, `content` only) are decrypted and scanned in chunks of 300 only for the notes that did not match, and the scan stops at 200 hits. Results are capped at 200; `limit/offset` page that set. Ranking, `matchSnippet` and the fuzzy-title fallback are unchanged.
- No SQL migration was needed for this.

## 11. Team lifecycle (branch feat-team; compiled with `npm run build:server`, NEVER run against a database)
Audit items R6, R8, R15, R16, R26, R27, R33. New file `routes/teamAdmin.ts` (mounted at `/api/workspaces` after `orgs.ts`); helpers `utils/seats.ts` and `utils/teamNoteInfo.ts`; migration `053_org_purge_after.sql` (the numbers 047-049 were already used, and the runner skips any version at or below the highest applied one, so 051 is used).
- `GET /orgs/:orgId/members/:userId/notes-summary` and `GET /orgs/:orgId/orphaned-notes` (owner/admin): what a person wrote per space; authors who are no longer members.
- `POST /orgs/:orgId/members/:userId/handover-notes {toUserId, spaceIds?}` (owner/admin): sets `notes.user_id` to the receiver for the person's non-trashed notes in the organization's open spaces, including private Office notes (`office_everyone` stays NULL, so they stay private to the new author). The receiver must be an active, non-guest, current member (`orgAccess`) and a lead/member of each space; spaces where they are not are skipped and reported in `skipped`. The sender may already be gone. Receiver's own `note_access` grants are deleted, tags are re-created for the receiver by name and the `note_tags` rows re-pointed, `updated_at` is not touched. Writes audit `member.notes_handover`, notifies the receiver (kind `status`), emits `notes_changed`. Not moved: files/images owned by the old author (they keep their old `user_id`).
- `DELETE /spaces/:spaceId/members/:userId` (space lead, or org owner/admin): last-lead guard (409 `last_lead`), the person's assigned tasks in that team become unassigned, audit `space.member_removed`, notification to the person. Returns `notes` (how many they wrote there).
- `GET /orgs/:orgId/closed-spaces`, `POST /spaces/:spaceId/reopen` (lead of that team, or owner/admin; organization must be active): clears `spaces.closed_at`, audit `space.reopened`, notifies the team.
- `DELETE /orgs/:orgId {confirmName}` (owner only): name must match; any other active member blocks it (409 `has_members`); then `organizations.status='closed'`, `closed_at=now()`, `purge_after=now()+30 days`, open invites and join links revoked, audit `org.deleted`, remaining members notified. Nothing is physically deleted and there is no purge job or restore yet; `orgAccess` hides a closed organization from everyone.
- Seat limit (`utils/seats.ts`): used = active non-guest members, pending = unexpired unaccepted non-guest invites, limit = `policy.seatLimit` (default 10). Checked in `POST /orgs/:orgId/invites` (a re-invite of the same email does not count twice), `POST /invites/accept` and `POST /join-links/accept` (inside the transaction after locking the organization row, so a refused join burns no use), and in `PATCH member` when a guest becomes a member or a paused member is resumed. Error body `{error, code:'seat_limit', limit, used, pending}`, status 409; the accept routes add `state:'seat_limit'`.
- Guest expiry: `PATCH /orgs/:orgId/members/:userId {guestUntil}` (ISO date, future, at most a year; guests only). Becoming a guest sets a 30-day end date; leaving the guest role clears `guest_until`.
- Team notes payload (`decorateNotes` in `utils/noteAccess.ts` now calls `decorateTeamNotes` for non-Office spaces): `team:true`, `owner:{id,name}`, `level` (`meta.teamShare.level`), `access` (`owner`/`edit`/`view`: view for a viewer role or a note shared "can view"), `canManage` (author or lead), `lastEditedBy` (latest `note_backups.saved_by`, else the author; approximate because the backup only records who overwrote the previous text).

## Sharing, invites, export, mute and @mentions (branch feat-share; NOT run against a database)

Code compiles (`npm run build:server`, esbuild; `tsc` is noisy without a generated Prisma client). Nothing below has been run against Postgres. Test steps: `docs/SERVER-TESTS-TO-RUN.md` items 9 to 14.

- **Migrations.** `051_invite_remind_space_prefs.sql` (`org_invites.last_reminded_at`; table `space_prefs(user_id, space_id, muted, updated_at)`, PK user+space) and `052_note_mentions.sql` (table `note_mentions(note_id, user_id, notified_at)`, PK note+user). The number 050 was already taken by `050_board_columns.sql`. The runner (`db.ts`) skips every file whose number is not above the highest applied version, so a second `050_*` file could be silently skipped on a database that already applied the first; that is why this work uses 051 and 052 only. Neither table is in `schema.prisma` (like the other raw-SQL org tables, audit M20).
- **Invites (R13), `routes/orgs.ts`.** The invite link is now `/invite#token=<raw>` (fragment, never sent to a server or logged); the `org_invite` notification has an empty body and the client sends the person to `/invite`. `GET /workspaces/invites/mine` (alias `/orgs/invites/mine`) lists the pending (and recently expired) invites for the signed-in, verified email. `lookup`, `accept` and `remind` take `{ token }` or `{ inviteId }`; an id only works when the signed-in email equals the invite email (otherwise `invalid`). `POST /invites/lookup` (body) was added so the token is not in a query string; the GET still works for old clients. `POST /invites/remind` claims `last_reminded_at` atomically: one per invite per 24 h, otherwise 429. `POST /orgs/:orgId/invites/:id/resend {mail?:false}` issues a NEW token (only a hash is stored, so the old link stops working), restarts the 7 days, mails it unless `mail:false`, returns `{link, mailed}`; 30 per hour per person; audit `invite.resent` / `invite.link_copied`.
- **Share policy (R9), `utils/shareScope.ts` + `routes/share.ts`.** `shareableNote(userId, id)` replaces the author-only `owned()` for notes: Personal = author; Team/Office = a person who can write in that space (viewers cannot); Office also needs owner or edit level; a team note shared "can view" is the author's to share. `shareBlockReason(spaceId)` refuses a NEW link (403 with `code` `org_policy` or `team_off`) when the organization policy `publicShares` is off or `spaces.public_links` is false; it also applies to tasks that live in a space. `GET /share/:kind/:id/allowed` answers `{allowed, code?, reason?}` for the client. Turning `publicShares` off (`PATCH /orgs/:id/policy`) calls `revokeOrgLinks`: every note and task link in the organization's spaces is set to NULL (token, edit, expiry) and the per-link tables (viewers, guests, blocked, reads, settings incl. short code) are purged, then audit `shares.revoked` with counts; the response carries `revoked: {notes, tasks}`. Turning a team's `publicLinks` off (`PATCH /spaces/:id`) revokes that team's links the same way. Task-list share links (`task_list_shares`) have no space and are not touched.
- **Export (R19).** `GET /orgs/:orgId/export` is gone. `POST /orgs/:orgId/export { password, includeTrash? }` (also `?includeTrash=1`): owner/admin only, bcrypt-checks the caller's password (8 wrong tries per 15 min per person), at most 3 per hour per organization (counted from `audit_log` action `org.exported`, 429 `export_limit`), writes the audit entry BEFORE reading anything, leaves out trashed notes unless asked, and streams the JSON while reading notes 200 at a time (cursor on id), so memory stays flat. If an error happens after the first byte the connection is destroyed (a truncated file never looks complete). Private Office notes are still withheld.
- **Mute a team.** `GET/PUT /workspaces/spaces/:id/prefs` (`routes/spacePrefs.ts`; caller must be in the space). `services/notify.ts notifyUsers` drops muted people before storing or emitting `notifications_changed` when the notification has a `spaceId`, except kinds `mention`, `note_mention` and `assigned` (direct to that person).
- **@mentions.** The editor writes `[@Name](peblo-user:<userId>)`. `services/mentions.ts notifyMentions` runs after `createNote` and `updateNote` (only when the saved text contains `(peblo-user:`; `updateNote` then reads the previous text first to find who is new): members of the note's space (not yourself) who can read the note (Office: `noteLevel`), one claim per (note, person) per 24 h in `note_mentions`, kind `note_mention`, title "<name> mentioned you in a note", body = the note title only. `GET /workspaces/spaces/:id/people-lite[?noteId=]` returns `{people:[{id,name,avatar}]}` (other active members; with an Office note only those who can read it). Not covered: saves made through the live-edit socket (`services/collab.ts`) and public edit links do not call `notifyMentions`; the editor's own autosave does go through `PATCH /notes/:id` (also with `collab:true`), which is covered. The public share page returns the note text as stored, so a mention's user id is visible to link readers.

- **Pin limit (N50).** `updateNote` in `notesController.ts`: when `meta.pinned` goes from not pinned to true and the person already has 3 pinned notes (not deleted, not archived, same `noteScope`, the note itself excluded) it answers 409 `{error, code:'pin_limit'}`. `MAX_PINNED = 3`. Not run against a database: see `docs/SERVER-TESTS-TO-RUN.md` step 46. The light list `wordCount` now comes from `utils/wordCount.ts`.

### `ANY_SPACE` and the Personal-only guard (found by running the smoke test, 2026-11-16)
`server/src/personalGuard.ts` adds `spaceId: null` to every Note/Todo query that does not mention `spaceId`. Code that must find a note in ANY space must say so with `...ANY_SPACE` (`{ spaceId: undefined }`, which Prisma ignores but the guard sees). Use it only where access is checked another way: share-token lookups (`routes/share.ts`), `shareableNote` / `shareVerdict` (`utils/shareScope.ts`, after `spaceAccess`), and `services/mentions.ts` (reads the note's space before deciding who may be notified). Without it team notes could not be shared by link and @mentions in team notes never notified. Smoke test: run with `PEBLO_TEST_DATABASE_URL` pointing at a local `peblo_test`; the org clean-ups must delete the spaces' notes, todos and announcements first (they are ON DELETE RESTRICT).

## Infrastructure round R4 (branch feat-r4, run against a local Postgres 2026-11-17)
- **SMTP sender (`services/mailer.ts`).** `tls.connect` passed `servername: SMTP_HOST` always. Node 26 throws `ERR_INVALID_ARG_VALUE` for an IP address as SNI (RFC 6066), so an `SMTP_HOST` given as an IP could never send (and `account-test`'s fake TLS server on 127.0.0.1 failed 2 checks). SNI is now sent only for a host name (`net.isIP`); certificate checks are unchanged. The reply reader also no longer drops a reply that arrives before anyone waits for it. `scripts/account-test.mjs` finds Git for Windows' `openssl.exe` next to `git.exe` (it is usually not on PATH) and clears `BREVO_API_KEY` too, so a key in `server/.env` cannot make the test send real mail.
- **Workspace tables in `schema.prisma` (M20).** Models now describe the raw-SQL tables of 035-053: `Organization`, `OrgMember`, `Space`, `SpaceMember`, `OrgInvite`, `AuditLog`, `Announcement`, `AnnouncementVersion`, `OrgAiKey`, `NoteAccess`, `OrgJoinLink`, `ShareReaction`, `TaskComment`, `TaskActivity`, `MemberAvailability`, `TaskTemplate`, `BoardColumns`, `SpacePref`, `NoteMention`, plus `Note.officeEveryone`, `Note.space`, `Todo.space`, `Todo.assignee`. They were compared with `prisma db pull --print` of a database with 001-053 applied: an offline `prisma migrate diff` between the two schema files shows no difference for these tables. The SQL files stay the source of truth (nothing was migrated, existing raw queries were not switched). Not expressible and left to SQL: CHECK constraints and the partial indexes `notes_space_idx` / `todos_space_idx`. Still missing from the schema (older raw-SQL tables, out of this change): `ai_usage`, `calendar_feeds`, `calendar_share`, `files`, `mcp_activity`, `media`, `note_comments`, `note_links`, `note_ydocs`, `password_resets`, `pending_signups`, `share_*` (activity, blocked, guests, polls, poll_votes, reads, settings, viewers), `task_list_*`, `user_notifications`, and the columns `note_backups.label/saved_by`; small drift on old models (`todos.tags` default, `share_expires_at` is timestamptz in SQL, some index names).
- **`POST /api/notes/bulk` (R37, `routes/notesBulk.ts`, mounted before the notes router with its own `authenticate`).** Body `{ action: archive|unarchive|trash|restore|pin|unpin|move|tag, ids (1-500, deduplicated), folder? (move; "" = out of folder), tag? }` -> `{ action, done: [ids], failed: [{ id, error, code }] }`. Scope from `noteScope(req,res,'write')` (a space viewer gets 403, an unknown space 404). Per note, the rights of the single routes: archive/unarchive/trash/restore = manage (Personal: own; Team: author or lead; Office: author), pin/unpin/move/tag = write (Team: not a note someone else shared "can view"; Office: author or edit). Codes: `not_found`, `owner_only`, `view_only`, `no_access`, `locked` (meta.locked skips every action except pin, unpin, restore), `pin_limit` (3 per scope, as PATCH), `private` (access tokens and #private notes). One transaction; pin/unpin/move are one jsonb `UPDATE` each and keep `updated_at` (as PATCH meta does); tag upserts the caller's tag and links it only where the note has no tag of that name, and bumps `updated_at`; trash leaves already trashed notes alone. `notes_changed` is emitted once.
- **Client (`client/src/soft/bulkRun.js`).** `bulkRun(items, fn)` first dry-runs `fn` per item against recorders swapped into the app's axios client (synchronously, then restored), and when every item is the same recognisable notes call it sends `POST /notes/bulk` in chunks of 500. On any error of the first request (404 from an older server included) it falls back to the old per-note path (5 at a time, 429 retried once). Same return shape, so `SoftNotes.jsx` is unchanged. Permanent delete, the archive toggle and a move that also drops tags stay per note.

## Sharing and teams round 3 (branch feat-r3; RUN against a local Postgres: smoke test block "R3", 49 checks)
Migrations `054_share_limits_activity.sql` (`share_settings.no_copy`, `share_viewers.user_id`, `share_reads.user_id`, `share_reads.visits`, index on share_reads) and `055_org_groups.sql` (`org_groups`, `org_group_members`). Both raw SQL, not in `schema.prisma` (audit M20). New files: `services/shareExtras.ts`, `routes/orgGroups.ts` (mounted inside `routes/orgs.ts` with `router.use`).
- **FM24 domain rule.** `organizations.policy.allowedDomains` (list, at most 20, cleaned by `utils/orgPolicy.ts cleanDomain`; a subdomain counts). Only an owner may change it (`PATCH /orgs/:id/policy {allowedDomains}`; admins get 403 `owner_only`; bad entries 400 `bad_domain`); the answer adds `outside` = members already in whose address is outside (they are not removed). Refused with 403 `{code:'domain_not_allowed', state, allowedDomains}`: `POST /orgs/:id/invites` (guests too), `POST /invites/accept` (an invite sent before the rule), `POST /join-links/accept`; the lookups answer `state:'domain_not_allowed'`. A refused join burns no use. No SSO.
- **Join links (R13).** Links are `/join#token=...` now; `POST /join-links/lookup {token}` added (GET kept for old clients). `middleware/errorHandler.ts` blanks `token|ticket|unlock|sid|key|code` query values in the URLs it logs. Nothing else logs tokens (mailer only writes to `MAIL_OUTBOX` in tests).
- **FM12 copy limit.** `POST /share/:kind/:id {allowCopy}` (default on) -> `share_settings.no_copy`; `GET /share/:kind/:id` returns `allowCopy`; the public `GET /public/note|todo/:token` returns `noCopy`. `services/agentView.ts` (the bot .md/.json/.txt/.pdf version) refuses an explicit extension with 403 and sends sniffed bots to the normal page while copying is off. agentView also now finds team notes (`ANY_SPACE`) and refuses a password-protected page without its unlock value (401; before, the .md version skipped the password).
- **M6 custom expiry.** `POST /share/:kind/:id {expiresAt: ISO | null}` (wins over `expiresInDays`): future, at most 10 years, else 400 `bad_expiry`.
- **M11.** `POST /public/:kind/:token/edit-request` and `/extend-request` store a notification for the item's owner (kind `share_request`, `noteId` or `todoId`; title names a guest as "<name> (guest)", a signed-in caller by account name). The same request within 10 minutes is not notified again.
- **M8.** Declined guests (`share_guests.status='declined'`) are kept 30 days (was 1). `GET /share/:kind/:id/requests` lists waiting (last hour), let-in and declined guests.
- **M13.** `share_reads` is now written for notes AND tasks (not for the owner), with `user_id` and `visits` (+1 each time the presence row is new). `GET /share/:kind/:id/opens` -> last 30 days: `{name, member, avatar, visits, firstAt, lastAt}` (a member by account name).
- **FM22 / M2 / M14 on links.** `share_viewers.user_id` is set for a signed-in viewer (and the owner); `listViewers` returns `member`, `guest`, `avatar`.
- **Live rooms (`services/collab.ts`, M17 / FM22).** Each connection has a server-side identity (`u:<userId>` with account name and avatar, or `s:<link session>` for a guest). Every awareness update is rewritten by `stampAwareness` before it is applied: `user = {name, color, avatar, member, guest, key}`; a guest keeps the typed name but is always `guest:true`. Colours come from `PEER_COLORS` per room: a colour nobody present has, the same for all tabs of one person, freed when they leave. New message `MSG_IDENT = 12` tells a client its identity (client `utils/collab.js` applies it). The share-link `authorize` now finds team notes (`spaceId: undefined`).
- **FM23 groups.** `GET/POST /orgs/:orgId/groups`, `PATCH/DELETE /orgs/:orgId/groups/:id` (owner/admin manage; members read; guests 403; names unique per org, any case; at most 50 groups, 200 members; only active non-guest members), `GET /spaces/:spaceId/groups` (members of each group who are in that team). A group grants nothing by itself: the client expands it into task assignees (max 10) or Office note access rows through the existing endpoints.
- **Tasks in a space and links.** All task lookups in `routes/share.ts` and `shareVerdict` use `ANY_SPACE` (access is still by owner `userId` or the token): the owner of a team task can share it and set its password/summary from the page (before, the Personal-only guard hid it).

## Notes R2 (branch feat-r2): locked notes, one-request folders and Trash (smoke test "R2 ..." checks, run on a local database)
- **Locked notes.** `updateNote` refuses a change of `title`, `content` or `tags` on a note whose `meta.locked` is true with 403 `{code:'locked'}`, unless the same request unlocks it (`meta.locked` sent as false/null/''). Sending the unchanged title, text or tags (tags compared lower-cased, as a set) is not a change. The check runs before the merge path, so merged and live saves are refused too. Other meta (favourite, pin, folder), archive, trash and move are not blocked by the server; the client skips locked notes for those.
- **`routes/notesBulk.ts`** (mounted at `/api/notes` BEFORE `routes/notes.ts`, so its paths never meet `/:id`; after the merge the same file also holds R4's `POST /bulk`, one router with one `authenticate` limited to its own paths by `BULK_PATHS`): `POST /folders/rename {from,to}` and `POST /folders/clear {name}` change `meta.folder` of the caller's own notes (`user_id = me`) in the current space (`space_id IS NOT DISTINCT FROM` the noteScope space) in one transaction with `jsonb_set` / `meta - 'folder'`, without touching `updated_at`; answers `{count}`. `GET /trash/info` answers `{retentionDays: 30 | null, purges}` (null in a space: the team Trash is never emptied on a timer). `POST /trash/empty` deletes the Trash of the current scope in one transaction (Personal: own notes; a space: needs `space.manage`, 403 `lead_only` otherwise; an Office: only the lead's own notes). `POST /trash/restore` puts the Trash back (Personal: own; a Team: a lead restores all, others only their own; an Office: own). Access tokens are refused for the writes. `TRASH_RETENTION_MS` is now exported from `notesController.ts`.
- Note: `purgeExpiredTrash` only removes Personal notes because the Personal-only guard adds `spaceId: null` to its query; that is what keeps team Trash out of the timed purge.
