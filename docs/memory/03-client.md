# Peblo client (React/Vite) — reverse-engineering report, core

Scope: `client/` boot, config, API layer, auth context, stores, hooks, utils, pages and `components/**`.
Not covered (another agent): `client/src/orbit`, `client/src/river`, `client/src/soft`, except how they are selected.
All paths below are relative to `client/src/` unless stated. Line numbers are from the files as read on 2026-10-08.

---

## 1. Boot and routing

### 1.1 Build / config
- `client/package.json`: name `peblo-notes-client`, scripts `dev` / `build` / `preview` (Vite 6). Key deps: React 19, react-router-dom 7, @tanstack/react-query 5 (+devtools, never mounted), axios, socket.io-client, zustand 5, BlockNote 0.51 (`@blocknote/core|react|mantine`) + Mantine 9, marked 15, diff 9, html2pdf.js, framer-motion, lucide-react, react-window (never imported), tailwindcss 4 + `@tailwindcss/vite` (plugin is NOT registered in `vite.config.js`, so Tailwind is unused), 11 `@fontsource/*` font packages.
- `client/vite.config.js`: dev server port 5173 (`strictPort: false`), proxies `/api` → `http://localhost:3001` and `/socket.io` → `http://localhost:3001` (ws). Sets COOP `same-origin-allow-popups` / COEP `unsafe-none` (leftover from Google sign-in popups). Build: manual chunks `vendor`, `ui`, `editor`, `utils`, `pdf`; `chunkSizeWarningLimit: 2000`.
- `client/.env.local`: only `VITE_GOOGLE_CLIENT_ID=841513539204-…apps.googleusercontent.com`. Nothing in `src/` reads it (dead config; Google sign-in has been removed).
- `client/index.html`: title "Peblo", `/favicon.svg`, meta description "Peblo Notes — AI-powered notes, to-dos and calendar", mounts `/src/main.jsx` into `#root`.

### 1.2 `main.jsx`
1. Imports all fonts for every style (Geist / Geist Mono / Instrument Serif for Studio; Space Grotesk / IBM Plex Mono for Console; Figtree / Bricolage Grotesque for Soft; Sora / Hanken Grotesk for River; Familjen Grotesk / Fragment Mono for Orbit) so the app works offline.
2. Imports global CSS in order `styles/index.css`, `styles/tokens.css`, `styles/canvas.css`.
3. If `location.pathname === '/quick-capture'`, adds class `pb-canvas-capture` to `<html>` before first paint (smaller design canvas, see canvas.css).
4. Creates a `QueryClient` with defaults `refetchOnWindowFocus: false`, `retry: 1`, `staleTime: 5 min`.
5. Render tree: `React.StrictMode > QueryClientProvider > BrowserRouter > AuthProvider > App`.
6. Unregisters any service workers left over from the old web/PWA version.

### 1.3 Design canvas (`design/canvas.js`, `styles/canvas.css`)
Every screen is laid out on a 1440 x 900 design canvas; Electron (`electron/main.cjs`) sets a zoom factor so that canvas fits the window and blocks user zoom. CSS uses `--pb-canvas-w: clamp(1440px, 100vw, 2160px)` and `--pb-canvas-h: max(900px, 100vh)`. `canvasWidth()` returns `#root.clientWidth || 1440`. Consequence: the viewport is never narrower than 1440 px, so every `canvasWidth() <= 768` branch and every `@media (max-width: 768px)` / `.mobile-only` block is effectively dead in the desktop app (see section 7). Quick-capture canvases: 620x256 (default), 760x400 (soft), 640x200 (river).

### 1.4 How the API base URL is chosen (desktop vs hosted vs dev)
The client always uses relative URLs: `baseURL: import.meta.env.VITE_API_URL || '/api'` (`api/client.js:7`); the same expression is repeated for fetch-based calls (`hooks/useHubChat.js:14`, `components/SettingsModal.jsx:42`, `components/AiChatPanel.jsx:334`). Which server answers depends on where Electron loaded the page from (`electron/main.cjs:92 appUrl()`):
- **Desktop (default):** Electron starts the Express API in-process on a random `127.0.0.1` port and loads the UI from it, so `/api` is same-origin.
- **Hosted / remote server:** if `PEBLO_API_URL` env var or `<userData>/server-url.txt` contains an http(s) URL, Electron loads the UI from that remote server (`readRemoteUrl()`), and `/api` resolves there.
- **Dev:** `PEBLO_DEV_URL` (e.g. `http://localhost:5173`) makes Electron load Vite; Vite proxies `/api` and `/socket.io` to `localhost:3001`.
- `VITE_API_URL` (build-time) overrides everything; the socket URL is derived by `VITE_API_URL.replace('/api','')`, otherwise `window.location.origin` (`context/AuthContext.jsx:138`).

### 1.5 Routes (`App.jsx`)
All shell routes are children of `ShellLayout` (pathless layout route). `ShellLayout` shows a spinner (`.page-loader`) while `useAuth().loading`, `<AuthScreen/>` if no `user`, else `<AppShell>` containing `<Suspense><Outlet/></Suspense>` plus lazily loaded global helpers `<AiVoiceCallManager/>` and `<CommandPalette/>`.

| Path | Studio / Console (`other`) | soft | river | orbit |
|---|---|---|---|---|
| `/` | `pages/HomePage` | SoftHome | RiverHome | OrbitHome (from OrbitAI) |
| `/notes`, `/notes/:id` | `pages/WorkspacePage` | SoftNotes | RiverNotes | OrbitNotes |
| `/tasks` | `pages/TasksPage` | SoftTasks | RiverHome `initialZoom="day"` | OrbitDue `view="list"` |
| `/calendar` | `pages/CalendarPage` | SoftCalendar | RiverHome `initialZoom="week"` | OrbitDue `view="week"` |
| `/quiz/:topic` | redirect to `/` (`GoHome`) | redirect | redirect | OrbitQuiz |
| `/ai` | `pages/AIHubPage` | SoftAI | RiverAI | OrbitAI |
| `/ai/connections` | `pages/ConnectionsPage` | SoftConnections | RiverConnections | OrbitConnections |

Outside the shell: `/quick-capture` → `CaptureGate` (renders nothing while loading; if signed out shows "Sign in to Peblo first…"; else `pages/QuickCapturePage` default export, which itself picks SoftCapture / RiverCapture / OrbitCapture by style). Redirects: `/workspace` → `/notes`, `/todolist` → `/tasks`, `*` → `/`. All pages are `React.lazy` loaded.

`Styled({ other, ...byStyle })` (`App.jsx:49`) picks `byStyle[uiStyle] || other`. "studio" and "console" have no entry, so they share the same pages; they differ only in the shell.

### 1.6 UI style and theme
- **Style** (`uiStyle`): `'studio'` (default) | `'console'` | `'soft'` | `'river'` | `'orbit'`. Held in `AuthContext`, persisted only on this device in `localStorage['peblo-style']` (not synced to the account). An effect writes `data-style="<style>"` onto both `<html>` and `<body>` (`AuthContext.jsx:62`); `styles/tokens.css` overrides tokens per `[data-style=…]`. Changed from Settings > Appearance (style cards) or Command Palette "Change style to …".
- **Shell per style** (`components/shell/AppShell.jsx`): `console` → `ConsoleShell`; `soft` → `soft/SoftShell`; `river` → `river/RiverShell`; `orbit` → `orbit/OrbitShell`; otherwise Studio: `<div.pb-shell><Sidebar/><main.pb-sheet/></div>`. All shell modules are imported eagerly (not lazy). SettingsModal is lazy and rendered next to whichever shell.
- **Theme**: `'light'` (Paper, default) | `'dark'` (Graphite) | `'midnight'` (pure black) | `'system'`, stored in `localStorage['peblo-theme']`. Effect toggles classes `theme-dark` (dark or midnight) and `theme-midnight` on `<body>` and `<html>`; for `system` it follows `prefers-color-scheme` and listens for changes. Theme cycle buttons in Sidebar/ConsoleShell go light → dark → midnight → light (system is only reachable in Settings).

### 1.7 Providers / global listeners
- `QueryClientProvider` (TanStack Query v5), `BrowserRouter`, `AuthProvider`.
- Window events used as an app bus: `peblo:signed-out` (401 → sign-out), `peblo:open-settings` (opens SettingsModal, listened in AppShell), `peblo:capture` (soft/river/orbit shells only), `note-updated` (listened by WorkspacePage, never dispatched), `todo-updated` (listened by CalendarPage, dispatched only by the dead AiChatPanel), `trigger_ai_call` / `snooze_ai_call` / `decline_ai_call` (voice call), `storage` (token change in another window).
- Socket.io connection while signed in (see 3.5).

---

## 2. API layer

### 2.1 Files
- `api/token.js`: token in `localStorage['peblo-token']` (shared by all windows including quick capture). `getToken()`, `setToken()`, `clearToken()` (all try/catch), `authHeaders(extra)` for fetch calls, `signOutIfRejected(res)` (on 401 clears token and dispatches `peblo:signed-out`).
- `api/client.js`: axios instance, JSON content type. Request interceptor adds `Authorization: Bearer <token>`. Response interceptor: on 401 for any URL other than `/auth/login|signup` → `clearToken()` + `peblo:signed-out`. No refresh-token logic; no timeout by default.
- `api/index.js`: grouped API objects (table below).

### 2.2 Every API function

| Object.fn | Method + path (relative to `/api`) | Body / params | Used by (core scope) |
|---|---|---|---|
| `authAPI.signup` | POST `/auth/signup` | `{name,email,password}` | `AuthContext.signIn` |
| `authAPI.login` | POST `/auth/login` | `{email,password}` | `AuthContext.signIn` |
| `authAPI.changePassword` | POST `/auth/change-password` | `{currentPassword,newPassword}` → `{token}` | SettingsModal (Your Data) |
| `authAPI.logoutAll` | POST `/auth/logout-all` | – | SettingsModal |
| `profileAPI.me` | GET `/profile` | → `{user}` (includes `settings` with decrypted API keys) | AuthContext boot |
| `profileAPI.updateProfile` | PUT `/profile` | `{name,email}` or `{jobTitle,bio,timezone,settings:{…}}` | `AuthContext.updateProfile`, `updateSettings` |
| `notesAPI.getAll` | GET `/notes` | params `sort`, `archived`, `deleted`, `tag` | WorkspacePage, Sidebar, HomePage, useShellData, useHubChat, useNoteDoc, CommandPalette |
| `notesAPI.get` | GET `/notes/:id` | → `{note}` | WorkspacePage, useNoteDoc |
| `notesAPI.create` | POST `/notes` | `{title,content,tags,category?}` → `{note}` | WorkspacePage (draft), QuickCapture, useHubChat.saveAsNote, useNoteDoc |
| `notesAPI.update` | PATCH `/notes/:id` | `{title,content,tags,category?}` | WorkspacePage autosave, useNoteDoc |
| `notesAPI.delete` | DELETE `/notes/:id` | – (move to trash, or permanent if already trashed) | WorkspacePage, useNoteDoc |
| `notesAPI.restore` | POST `/notes/:id/restore` | – | WorkspacePage, useNoteDoc |
| `notesAPI.archive` | POST `/notes/:id/archive` | – (also used for "Unarchive") | WorkspacePage, useNoteDoc |
| `notesAPI.getBackups` | GET `/notes/:id/backups` | → `{backups:[{id,content,createdAt}]}` | WorkspacePage |
| `notesAPI.revertBackup` | POST `/notes/:id/backups/:backupId/revert` | → `{note}` | WorkspacePage |
| `aiAPI.summary` | POST `/notes/:id/ai/summary` | `{title,content}` → `{summary}` | WorkspacePage |
| `aiAPI.actions` | POST `/notes/:id/ai/actions` | → `{action_items:[]}` | WorkspacePage |
| `aiAPI.title` | POST `/notes/:id/ai/title` | → `{suggested_title}` | WorkspacePage |
| `aiAPI.suggestTag` | POST `/notes/:id/ai/tags` | – | **unused** |
| `aiAPI.linkPreview` | GET `/ai/link-preview?url=` | → `{url,title,description,domain,image}` | WorkspacePage |
| `aiAPI.ollamaCheck` | GET `/ai/ollama/check?url=` | → `{ok,models,error}` | SettingsModal, ConnectionsPage, ConnectionsScreen |
| `aiAPI.chat` | POST `/ai/chat` | `{message, mode:'append', noteId}` → `{reply, updatedNote}` | WorkspacePage "Chat Copilot" |
| `aiAPI.smartIntake` | POST `/ai/smart-intake` | `{rawData,template}` → `{reply,note,todos}` | AiChatPanel (dead) |
| `aiAPI.smartIntakeUpload` | POST `/ai/smart-intake-upload` | multipart `file`, `context` | AiChatPanel (dead) |
| `aiAPI.processBlock` | POST `/notes/block/ai` | `{text, command: summarize\|todo\|improve\|continue}` → `{result}` | BlockEditor slash menu |
| `aiAPI.processVoiceCommand` | POST `/notes/voice-command` | `{transcript,timezone,localTime}` → `{responseSpeech,needClarification,snooze,snoozeMinutes,actions[]}` | AiVoiceCallModal |
| `dashboardAPI.insights` | GET `/dashboard/insights` | → `{activityHeatmap,streakStats,topTags,totalNotes,…}` | HomePage |
| `dashboardAPI.toggleTask` | POST `/dashboard/toggle-task` | – | **unused** |
| `dashboardAPI.dailyBriefing` | GET `/dashboard/daily-briefing` | → `{stats:{dueToday,overdue,completedYesterday},overdueTasks,todayTasks,tip}` | HomePage |
| `dashboardAPI.weeklyReport` | GET `/dashboard/weekly-report` | → `{stats:{notesEdited,completionRate}}` | HomePage |
| `todosAPI.getAll` | GET `/todos` | params e.g. `{noteId}` → `{todos}` | TasksPage, NoteContextPanel, TodoListPanel |
| `todosAPI.getToday` | GET `/todos/today` | → `{todayTasks,overdueTasks,upcomingTasks}` | HomePage, Sidebar, useShellData, AiVoiceCallManager |
| `todosAPI.getRange` | GET `/todos/range?from&to` | ISO strings → `{todos}` | CalendarPage, HomePage |
| `todosAPI.create` | POST `/todos` | `{text,priority,tags,deadline,startTime,endTime,recurrence,noteId}` + `timezone` (IANA, auto-added) | TasksPage, NoteContextPanel, QuickCapture, CalendarPage, TodoListPanel |
| `todosAPI.update` | PATCH `/todos/:id` | partial + `timezone` | many |
| `todosAPI.delete` | DELETE `/todos/:id` | – | TasksPage, CalendarPage, TodoListPanel |
| `transferAPI.importFiles` | POST `/import` | multipart field `files` (many), 10 min timeout → `{imported,skippedImages,skippedFiles}` | SettingsModal |
| `hubAPI.models` | GET `/ai/hub/models` | → `{local:{enabled,ok,models,chatModel,error}, cloud:[{provider,model,label,configured}], routing}` | Sidebar, useShellData, HomePage, useHubChat, ConnectionsPage, ConnectionsScreen |
| `hubAPI.search` | POST `/ai/hub/search` | `{query,noteIds}` | orbit/river only |
| `studyAPI.mastery/quiz/answer/noteQuestions` | GET `/study/mastery`; POST `/study/quiz` (5 min timeout); POST `/study/quiz/:id/answers`; GET `/study/notes/:noteId/questions` | | orbit only |
| `riverAPI.brief/findPromises/promises/setPromise` | POST `/river/brief`; POST `/river/notes/:id/promises`; GET `/river/promises`; PATCH `/river/promises/:id` | | river only |

Calls that bypass axios (use `authHeaders` + `signOutIfRejected`):
- POST `/ai/hub/chat` (SSE stream) — `hooks/useHubChat.js:142`.
- GET `/export` (zip download `peblo-notes.zip`) — `SettingsModal.jsx:42`.
- POST `/ai/chat-stream` (SSE) — `AiChatPanel.jsx:335` (dead component).

Realtime: socket.io client connects to the API origin with `auth: cb({token})`; listens for `todos_changed` and `notes_changed`.

---

## 3. Auth flow (`context/AuthContext.jsx`)

### 3.1 State held in context
`user`, `loading`, `connectError` (`'offline'` | `'error'` | null), `theme`/`setTheme`, `uiStyle`/`setUiStyle`, `settings`/`updateSettings`, `notifications` + `addNotification`/`markNotificationRead`/`markAllNotificationsRead`/`clearNotifications`, `signIn`, `logout`, `retryConnect`, `updateProfile`.

### 3.2 Start-up
- No token → `user=null`, `loading=false` → AuthScreen.
- Token present → `GET /profile`. Success → `adoptProfile(user)`: sets user and merges `user.settings` into local settings as `{ ...serverSettings, ...localSettings }` (local wins) and writes `peblo-settings`. Failure: a 401 is already handled by the interceptor (token cleared); no response → `connectError='offline'`; other status → `'error'`. AuthScreen shows a banner "Can't reach the Peblo server." / "The Peblo server had a problem." with "Try again" (`retryConnect` bumps `reloadKey`, re-running the effect).

### 3.3 Sign up / sign in (`components/AuthScreen.jsx`)
- Two modes, `login` (default) and `signup` (adds "Your name", optional, max 80). Password show/hide toggle. Client check: signup password >= 8 chars. Form uses `noValidate`; submit disabled until email and password are non-empty.
- `signIn(mode, form)` → POST `/auth/signup` or `/auth/login` → `queryClient.clear()`, `setToken(res.data.token)`, `adoptProfile(res.data.user)`.
- Errors: server `error` string, else "Something went wrong" or "Can't reach the Peblo server. Is it running?". No "forgot password" (Settings text: "There is no email reset yet").
- No guest/local/offline mode exists: everything requires an account and a reachable server. No token refresh: the JWT lives until it expires or is rejected.

### 3.4 Sign out
- `logout()` (Settings > Sign out, and after Sign out everywhere): `clearToken()`, removes every `localStorage` key starting with `peblo-` except `peblo-theme` and `peblo-style`, resets settings to `{fontSize:'medium', wordWrap:true, autoTitle:true}`, empties notifications, `queryClient.clear()`, `user=null`. No server call (stateless JWT stays valid until expiry unless "Sign out everywhere" was used).
- Forced sign-out (`peblo:signed-out` from any 401): only `setUser(null)` + `queryClient.clear()`. Local settings, AI Hub chats and cached notes are NOT cleared (see bugs).
- Cross-window: a `storage` event on `peblo-token` (sign in/out in another window, e.g. quick capture) bumps `reloadKey` and re-runs the profile load.
- Change password (Settings): POST `/auth/change-password` → stores new token (server signs out other devices). "Sign out everywhere": POST `/auth/logout-all`, then local `logout()`.

### 3.5 Real-time sync
While `user` is set: `io(socketURL, { auth: cb => cb({ token: getToken() }) })`. `todos_changed` → `invalidateQueries(['todos'])`; `notes_changed` → `invalidateQueries(['notes'])`. Disconnects on sign-out/unmount. (In TanStack v5 the array form is treated as a filters object with no `queryKey`, which invalidates every query; see bugs.)

### 3.6 Profile / settings sync
- `updateProfile(partial)`: optimistic `setUser`, then `PUT /profile` (errors only logged; no rollback).
- `updateSettings(partial)`: merges into local settings + `peblo-settings`, then fire-and-forget `PUT /profile` with `jobTitle`/`bio`/`timezone` at top level and every other key under `settings` (server merges into its JSON and stores API keys encrypted in a separate table; `GET /profile` returns them decrypted).

---

## 4. State, caching and storage

### 4.1 Zustand stores (`store/`)
- `useWorkspaceStore` (not persisted): `searchQuery`, `filterTag`, `sortBy` ('updated' | 'created' | 'title'), `showArchived`, `showDeleted`, `sidebarOpen`, `aiPanelOpen`, `isFocusMode`, `showTodoList`, `showBackups`, `isMobileMenuOpen` (unused), `isShareModalOpen` (unused, no share modal exists) with setters/toggles. Used by WorkspacePage and the `components/workspace/*` parts.
- `useUIStore` (persisted via `zustand/middleware persist`, key `peblo-ui-storage`): AI chat panel open state, `aiChatMessages` (persisted minus errors), `hasChatted`, `isSidebarOpen`. Only imported by the dead `AiChatPanel.jsx`, so it is never instantiated in the running app.

### 4.2 Hooks (`hooks/`)
- `useDebounce(value, delay=500)`: imported by WorkspacePage but not used.
- `useAutoSave(noteId, data, saveFn, delay=1500)`: debounced autosave with status `'saved' | 'unsaved' | 'saving' | 'error'`. Keeps `lastSavedRef` (JSON of last saved payload) and `pendingRef[noteId]`. Saves after 1.5 s idle; flushes on note switch (cleanup of the `[noteId]` effect) and on `beforeunload`; `forceSave()` cancels the timer and saves now. Resets status when `noteId` changes. No retry after an error until the next edit.
- `useKeyboardShortcut(key, cb, {ctrl, shift})`: window `keydown` listener in the **capture** phase; requires Ctrl/Cmd if `ctrl`, Shift if `shift` (does not require their absence), then `preventDefault()` + `stopPropagation()`.
- `useHubChat()`: shared AI Hub engine (see 5.9).
- `useNoteDoc()`: note document hook for River and Orbit note screens (draft creation on first content, autosave, archive/trash/restore, `.md` export, tags). Not used by Studio/Console.

### 4.3 React Query keys in use (core)
`['notes', {sort, archived, deleted, tag}]` (WorkspacePage), `['notes','sidebar']` (Sidebar, HomePage, useShellData, useHubChat, useNoteDoc), `['todos','all']` (TasksPage), `['todos']` (TodoListPanel), `['todos','note',noteId]` (NoteContextPanel), `['todos','today']` (HomePage), `['todos','today','sidebar']` (Sidebar, useShellData; 30 s stale), `['todos','range','home',dayKey]` (HomePage), `['dashboard','briefing'|'insights'|'weekly']` (HomePage), `['hub-models']` (Sidebar/useShellData: 30 s stale, refetch every 60 s; HomePage, useHubChat, ConnectionsPage). CalendarPage and CommandPalette do not use React Query (local state + direct calls).

### 4.4 Every localStorage key
| Key | Written by | Content | Cleared by `logout()`? |
|---|---|---|---|
| `peblo-token` | `api/token.js` | JWT | yes |
| `peblo-theme` | AuthContext | light/dark/midnight/system | no (kept on purpose) |
| `peblo-style` | AuthContext | studio/console/soft/river/orbit | no (kept on purpose) |
| `peblo-settings` | AuthContext | all settings JSON, **including `openAiKey` / `geminiKey` in plain text** | yes |
| `peblo-notifications` | AuthContext | notification list (3 seeded welcome tips) | yes |
| `peblo-sidebar-collapsed` | AppShell | '1' / '0' | yes (side effect of prefix wipe) |
| `peblo-ai-hub-v1` | useHubChat | up to 60 chats with messages and sources | yes |
| `peblo-ai-hub-model` | useHubChat | `{provider, model}` or null | yes |
| `peblo-ui-storage` | useUIStore (dead) | AI chat panel history | yes (never written) |
| `peblo_cached_notes` | WorkspacePage | full note list (title + content) for instant first paint | **no** (underscore prefix) |
| `peblo_last_morning_briefing` | AiVoiceCallManager | `Date.toDateString()` | **no** |
| `peblo_called_tasks` | AiVoiceCallManager | `{taskId:true}` map, grows forever | **no** |
| `peblo_call_gender` | AiVoiceCallModal | female/male | **no** |
| `peblo_call_rate` | AiVoiceCallModal | 0.85/1.05/1.25 | **no** |
| `peblo_call_ringtone` | AiVoiceCallModal | chime/none | **no** |
| `peblo-river-zoom`, `peblo-river-notes-view` | river/* (other agent) | | yes |

---

## 5. Features

### 5.1 Shell / sidebar
- **Studio `Sidebar`** (`components/shell/Sidebar.jsx`): brand ("<FirstName>'s workspace"), collapse toggle (persisted `peblo-sidebar-collapsed`), "Search or ask… Ctrl K" button (`openCommandPalette()` dispatches a synthetic Ctrl+K keydown on `window`), nav: Home, Inbox (`/notes?tag=inbox`, with count of notes tagged `inbox`), Notes, Tasks (count = today + overdue), Calendar, AI Hub (Ctrl J). "Recent" = top 3 notes by updated. "Tags" = top 5 tags by count (excluding `private`), click → `/notes?tag=x`. Trust card linking to `/ai/connections` shows "Saved to your account", the model line (local model / "Ollama not running" / cloud model / "No AI set up") and routing label (`ollama` Local only, `ask` Ask before cloud, `auto` Best available, `openai`/`gemini` … first). Footer: avatar initial, name, theme cycle button, Settings.
- **`ConsoleShell`**: icon rail (Home, Notes, Tasks, Calendar, AI Hub, "+" quick add → `/tasks?add=1`, theme cycle, Connections, Settings), top command bar (text submitted → `/ai?q=…`; empty Enter opens the palette), model pill, initials avatar (opens Settings), status bar "saved to your account · N notes · N open tasks" and key hints. Data from `useShellData()`.
- **`AppShell`**: global Ctrl/Cmd+J → `/ai` except on `/notes/:id`; listens for `peblo:open-settings`.

### 5.2 Notes workspace (`pages/WorkspacePage.jsx` + `components/workspace/*`)
Layout: `NotesSidebar` | main editor column (`MobileEditorControls`, `EditorToolbar`, `BackupsPanel`, trash banner, title + tags + meta, `BlockEditor`, link previews, footer hint) | `AiWorkspacePanel` (when open) | `NoteContextPanel` (when the AI panel is closed and not in focus mode). `TodoListPanel` overlays on the right when "Tasks" is toggled. With no note selected: `WelcomeScreen`.

**List (`NotesSidebar`)**: header with count, "+" (new note), hide-list button. Search box `#search-input` filters client-side on title and content. View chips: All / Inbox (= tag filter `inbox`) / Archive / Trash. Tag `<select>` (all tags of loaded notes) and sort `<select>` (Recently edited / Recently created / A to Z). When sorted by updated, rows are grouped Today / Yesterday / This week / This month / Earlier. Each row: title, 120-char stripped snippet, first tag (+N), short time, sparkle if `hasSummary`; hover actions Archive/Unarchive + Move to Trash, or in Trash: Restore + Delete forever. Rows are keyboard operable (Enter/Space). Skeleton rows while loading; empty states per view.
- Query: `GET /notes?sort&archived&deleted[&tag]`. The unfiltered list is cached in `localStorage['peblo_cached_notes']` and used as `initialData` (with `initialDataUpdatedAt: 0`, so it refetches immediately).
- URL `?tag=x` sets the tag filter on load (sidebar Inbox/Tags links).

**Drafts and saving**: "New note" (`handleCreateNote`, Ctrl+N) creates an in-memory draft `{id:'__draft__', isDraft:true}` and navigates to `/notes`. Nothing is created on the server until the title or content is non-empty; the first autosave POSTs `/notes` (title defaults to "Untitled"), prepends the note into every `['notes', …]` cache and replaces the URL with `/notes/:id` while keeping the editor key, so the editor is not reloaded. Later saves PATCH `/notes/:id` with `{title, content, tags, category}` 1.5 s after the last change (`useAutoSave`); Ctrl+S forces it. Status shown in toolbar: "Saving…", "Save failed", "Draft · start typing to save", "Saved to your account". "Untitled" titles are shown as an empty input with placeholder.
- Opening a note: route `/notes/:id` → use the list copy if it has `content`, else `GET /notes/:id` (on error redirect to `/notes`). `applyNoteToEditor` resets title/content/tags/category, loads stored AI results from `note.aiGenerations`, closes AI panel/backups/diff.
- Delete: confirm "Move this note to trash?" or (if already deleted) "Permanently delete this note? This cannot be undone." → DELETE. Archive/Restore without confirm. All three remove the row from the current list and close the note if open.
- Trash banner on a deleted note with Restore / Delete permanently; title, tags and editor are disabled.
- Tags: inline chips with ×, "Add tag…" input (Enter, lowercased, de-duplicated). Meta line: "Edited <relative date> · N words · N min read" (200 wpm).
- Link previews: every `https?://…` URL in the content is detected (on every content change); YouTube links (`youtu.be`, `youtube.com/watch|shorts|embed`, `m.`, `youtube-nocookie`) become embedded iframes; other URLs call `GET /ai/link-preview`. Shown behind a "Show links (N)" toggle.
- Export (toolbar "More" menu or mobile menu): Markdown (`# title` + content), PDF (dynamic `html2pdf.js`, A4, from `marked` HTML), Word (`.doc` = HTML with Office namespaces), HTML (styled standalone page), plain text. Filenames are the title with non `[A-Za-z0-9-_ ]` removed and spaces → `_`.
- Focus mode (toolbar button) hides the context panel and the note list; the "Tasks" button toggles `TodoListPanel`; preview toggle (Ctrl+P) only makes the BlockNote editor read-only (there is no separate rendered preview).
- `compact-mode` class applied when `settings.compactMode`.
- `EditorErrorBoundary` wraps the editor ("Failed to load note editor" + Try again).
- Mobile swipe-to-open-sidebar and mobile header/bottom bar exist but never activate on the 1440 px canvas.

**Block editor (`components/BlockEditor.jsx`)**: BlockNote (`useCreateBlockNote`) with Mantine theme light/dark following the app theme. Content is stored as Markdown: on mount it parses `initialContent` with `tryParseMarkdownToBlocks` (only once per editor instance; parent remounts it via `key`), and on every change serialises with `blocksToMarkdownLossy` (lossy: BlockNote-only formatting is lost). A `loadingRef` suppresses the onChange fired by the initial load. Custom slash menu (`/`): four "AI Assistant" items placed before the defaults:
- AI Summarize Block (`summarize`), AI Action Items (`todo`), AI Improve Writing (`improve`), AI Continue Writing (`continue`) → POST `/notes/block/ai {text, command}` with the current block's text. While waiting the block shows italic "AI is processing...". The result is split into lines: first line replaces the block, the rest are inserted after it, as `checkListItem`s for `todo` (stripping `-`, `[ ]`, `1.` prefixes) or paragraphs otherwise. Empty block → `alert`. Failure restores the original block and `alert`s.
- Props: `editable`, `formattingToolbar` (River/Orbit/Soft also use this component).

**Toolbar (`EditorToolbar`)**: breadcrumb `Notes / #firstTag / title`, save status, Tasks toggle (not for drafts), focus mode, preview/edit, More menu (Version history, 5 exports; not for drafts), "Ask AI" (toggles AI panel, Ctrl+J).

**Backups / versions (`BackupsPanel` + `DiffViewer`)**: "Version history" (toolbar, mobile menu or the context panel's History link) → GET `/notes/:id/backups`. The server keeps a copy each time AI changes a note (empty-state text says so). Each backup row: relative date, Compare, Restore. Restore confirms ("…Current changes will be overwritten."), POSTs `…/revert`, applies the returned note, updates caches and closes the panel.
- `DiffViewer` (`diff.diffLines(backup, current)`): toolbar Back to list / Side-by-Side vs Inline toggle / Restore Version. Side-by-side pairs a removed block with the following added block row by row and pads with empty rows; inline shows +/- markers.

**AI workspace panel (`AiWorkspacePanel`)** ("AI Workspace Copilot", opened by Ask AI / Ctrl+J / context panel):
- *Insights* tab: Generate Summary, Extract Action Items, Suggest Title (disabled without content). A draft is saved first. Calls POST `/notes/:id/ai/summary|actions|title` with `{title, content}`. Results card: summary text, action items list (display only, not turned into tasks), suggested title with "Apply" (sets the title, then autosave). A summary also sets `hasSummary` and updates `aiGenerations` in caches. Errors show the server message or, on 502, "AI service unavailable. Check GEMINI_API_KEY in server/.env…".
- *Chat Copilot* tab: in-memory chat (lost on note switch/reload), suggestion chips (Summarize Takeaways, Make Checklist, Improve Grammar, Brainstorm Ideas) that only fill the input. Submit → POST `/ai/chat {message, mode:'append', noteId}`. If `updatedNote` is returned the editor is reloaded with it (new editor key) and caches updated. Replies rendered with `marked.parse` via `dangerouslySetInnerHTML`.

**Context panel (`NoteContextPanel`)**: right column.
- "Ask about this note" input → navigates to `/ai?q=<text>&note=<id>&noteTitle=<title>` (AI Hub starts a new chat with the note attached). Chips: Summarise (opens AI panel + summary), Get tasks (opens AI panel + action items), Flashcards (asks the Hub "Make 8 flashcards (question and answer) from this note."). Disabled for drafts.
- Linked tasks: `GET /todos?noteId=` (`['todos','note',id]`); open tasks with checkbox and due label ("High · due today/tomorrow/overdue/due Mon 6 Oct"), plus up to 3 done ones; optimistic toggle → PATCH; "Add a task, e.g. revise tomorrow !high" parsed with `parseTask` and created with `noteId`.
- Backlinks: up to 6 other non-deleted notes whose content contains this note's title (title must be >= 4 chars; plain substring match).
- Footer: Created date + History link.

**Welcome (`WelcomeScreen`)**: "Choose a note to open", New Note, Open latest, shortcut hints (Ctrl+N, Ctrl+K, Ctrl+S), grid of 6 recent notes.

### 5.3 Tasks (`pages/TasksPage.jsx`)
- Top bar: List/Calendar segmented control (Calendar is a link), "Plan my day" → `/ai?q=Plan my day from my tasks and deadlines`.
- Left: "This week" header with counts, tag filter chips (top 5 `todoTags` by frequency; the active tag is auto-added to new tasks), natural-language add box `#task-add` with live preview badges (date, priority, tags). `?add=1` focuses it (used by the Console "+" button). Groups: Overdue (deadline before today 00:00), Today, Tomorrow, Later this week (day+2 .. day+6), Later (first 15), No date; sorted by priority then deadline. "Done" group collapsed by default (max 30 shown). Row (`TaskRow`): checkbox (PATCH completed), text, recurrence ("repeats weekly"), linked note link, up to 2 tags, due label (Today / Tomorrow / Yesterday / weekday / date + HH:MM unless 23:59), High/Low badge, delete (no confirm). Every mutation invalidates `['todos']` and `['dashboard']`.
- Right "day plan": week strip (Mon-start, prev/next week, dot when the day has open tasks), selected day list: untimed tasks on top, timeline 07:00–22:00 (44 px/hour) with blocks positioned by `startTime`/`endTime` (or the deadline's time; default 45 min).
- Data: `GET /todos` (all tasks, client-side grouping).

**Natural-language parsing (`utils/parseTask.js`)**: input padded with spaces, then:
1. Priority: `!high|!h|!urgent` → high, `!low|!l` → low, `!medium|!med|!m` → medium (default medium). Last match wins.
2. Tags: every ` #word` (Unicode letters/digits/_/-), lowercased.
3. Date (only the first occurrence of each pattern, applied in order so a later pattern overrides): `today|tonight` → today 17:00; `tomorrow|tmrw|tmr` → tomorrow 17:00; `[on |next ]<weekday>` → next occurrence of that weekday at 17:00 (same weekday → +7 days).
4. Returns `{text (collapsed whitespace), priority, tags, deadline: Date|null}`. No time-of-day, no "in N days", no dates like "12 Oct". Used by TasksPage, NoteContextPanel, QuickCapturePage and soft/river/orbit capture.

**Unused task components** (not imported anywhere): `components/todo/TodoCreateForm.jsx` (text, start/end time, recurrence none/daily/weekly/monthly/yearly, priority buttons, date, comma tags, linked note, `?deadline=` prefill), `todo/TodoItem.jsx` (framer-motion row, menu: Edit Task, Start Timer 25 min, Snooze Tomorrow, Delete), `todo/TodoEditModal.jsx` (edit text, priority, deadline date, time window, recurrence, tags, linked note), `dashboard/DashboardTodoItem.jsx`, `calendar/CalendarTaskItem.jsx` (double-click to edit).

**`TodoListPanel`** (notes "Tasks" button): add (plain text, no parsing), list of open tasks with priority dot, note icon, delete; completed section. React Query key `['todos']` with optimistic toggle. Shows all tasks, not the note's tasks.

### 5.4 Calendar (`pages/CalendarPage.jsx`, styles `dashboard.css` + `calendar.css` + `calendar-pb.css`)
- Local state (no React Query); loads `GET /todos/range` for the displayed month (1st 00:00 → last day 23:59:59), reloads on month change and on window `todo-updated`.
- Header: prev/next month, label (month, or the selected day in Day view), Month/Day toggle, Today.
- Stats strip: total, done, overdue (click → jump to the oldest overdue task's day), "urgent" (open high-priority).
- Month grid: 6x7, days outside the month are blank, today badge, open-task count, one priority-coloured dot per open task, check mark when all done, red `overdue` state when the day has passed with open tasks. Click selects a day. Cells accept drops.
- Day view: "All Day" strip (tasks without `startTime`, click toggles done) and a 24-hour timeline at 1 px per minute with tasks placed by start/end time (default 60 min, min 25 px); clicking toggles done.
- Right sidebar for the selected day: relative label (Today / Tomorrow / Yesterday / In N days / N days ago), date badge, pending/done counts, open tasks sorted by start time then priority (check ring, inline edit form saved on submit/blur, priority label, time, recurrence, tags, delete, open linked note), completed tasks. Tasks in the sidebar are draggable onto grid cells: the drop sets `deadline` to that date 23:59:59.999 (PATCH, rollback on error). "Add task" inline form: text, start/end time, recurrence, High/Med/Low → POST with deadline = selected day 23:59:59.999.
- Keyboard: ArrowLeft/ArrowRight move the selected day (and month), N opens the add form (ignored when focus is in an input/textarea).
- A mobile overlay panel duplicates the sidebar (never visible at 1440 px).

### 5.5 Home / dashboard (`pages/HomePage.jsx`, `styles/home.css`)
- Top bar: date, "Quick capture Ctrl Shift Space" hint.
- Hero: "<Weekday> morning/afternoon/evening", "Good morning, <FirstName>." (hides the placeholder name "You"), subtitle "N tasks due today · N overdue · N notes edited this week". Stats: current day streak (`insights.streakStats.current`), "% tasks done this week" (`weekly.stats.completionRate`).
- Ask box → `/ai?q=…`; model pill (local model / cloud model / "Set up AI") linking to Connections; 3 suggestion chips.
- Cards: **Today** (overdue + today tasks from `/todos/today`, max 6, checkbox toggles via PATCH, meta "Overdue" or time, first tag, "linked to <note>"); **Next few days** (from `/todos/range` today..today+3, open tasks, up to 3 days with tasks, 3 items each, "TODAY"/weekday labels); **Daily brief** (bullets from briefing stats: overdue count + first overdue task, due today + first task, finished yesterday, most-used tag; fallback "A clear day…"; server `tip`; "Plan with AI"); **Recently edited** (3 notes); **Momentum** heatmap (last 18 weeks of `insights.activityHeatmap`, 5 levels by `total`: 0, <2, <4, <7, >=7, coloured with `--pb-heat-0..4`), "N notes · longest streak N days".
- **Unused dashboard components**: `components/Heatmap.jsx` (month-grouped GitHub-style heatmap with tooltips, busiest day, current streak, edits this month), `components/DonutChart.jsx` (SVG donut of `aiUsage.byType`: summary/action_items/title/chat), `components/WritingStreak.jsx` (streak card, 7-day milestone progress bar), `components/RecentAiActivity.jsx`, `components/AnimatedTabBar.jsx` + `config/navTabs.jsx` (old top/mobile tab bar; Tasks still points at `/todolist`). None are imported.

### 5.6 AI chat panel (`components/AiChatPanel.jsx`) — not mounted
An 804-line floating, draggable "AI Note Assistant" (FAB "AI Assistant ⇧⌘A") that is imported nowhere, so it never renders. Features: modes *Smart Intake* (default; paste meeting notes/emails/braindumps or attach a `.pdf`/`.txt` → POST `/ai/smart-intake` or `/ai/smart-intake-upload`, shows created note + tasks; templates auto/meeting/email/project/braindump/syllabus are defined but no UI selects them), *New notes* (SSE POST `/ai/chat-stream`, extracts the `"reply"` field from streamed JSON chunks with a regex), and *append* (auto-selected on `/notes/:id`, note picker). Slash commands `/summarize`, `/actions`, `/rewrite`, `/fix`; Web Speech dictation (en-US); history persisted via `useUIStore` (`peblo-ui-storage`); Esc closes. Styles: `styles/ai-chat.css`.

### 5.7 AI voice call (`AiVoiceCallManager.jsx`, `AiVoiceCallModal.jsx`, `styles/ai-call.css`)
Mounted globally in the shell. A simulated "incoming phone call" from "Peblo Assistant".
- **Manager**: on mount and every 60 s calls `GET /todos/today` (today + overdue + upcoming). Triggers:
  1. *Morning briefing*: between 07:30 and 07:59 local time, once per day (`peblo_last_morning_briefing`), with tasks that have no deadline, are due today, or are overdue.
  2. *Upcoming task*: the first open task whose deadline is 0–2.1 hours away and not yet called (`peblo_called_tasks`), type `upcoming_task`.
  3. *Manual*: window event `trigger_ai_call` (nothing dispatches it).
  - Snooze (`snooze_ai_call`, default 10 min) and Decline (`decline_ai_call`, re-ring after 1 h) schedule a re-trigger.
- **Modal** states RINGING → SPEAKING → LISTENING → PROCESSING. Ringing plays a synthesized 440/480 Hz ring (Web Audio) unless ringtone is "Muted". Buttons: Decline, Snooze, Answer. Answer requests the mic (skipped when `navigator.webdriver`), builds an intro ("Good morning! You have N tasks scheduled for today… Task 1: …, scheduled for <time>"; plus up to 2 unread in-app notifications; or for `upcoming_task` "This is a reminder for your upcoming task…"), speaks it with `speechSynthesis` (voice picked by gender name heuristics, pitch 0.85/1.05, rate from settings), then listens with Web Speech recognition (continuous, interim). 3 s of silence (or the check button) ends the utterance → POST `/notes/voice-command {transcript, timezone, localTime}`. Responses: `needClarification` (asks again, keeps a dialogue history string), `snooze` (snoozes N min), else applies `actions` (COMPLETE / RESCHEDULE / CREATE) to the on-screen agenda, invalidates some caches, speaks `responseSpeech`, ends the call. Errors speak "Sorry, I had trouble connecting…" and listen again. A live mic bar visualizer (AnalyserNode) draws while listening. Gear icon: Voice Gender (female/male), Speaking Rate (Slow 0.85 / Normal 1.05 / Fast 1.25), Ringtone (Synth Chime / Muted), saved to `peblo_call_*`. Debug hook `window.__simulateVoiceCommand(text)` is exposed while the modal is open.

### 5.8 Quick capture (`pages/QuickCapturePage.jsx`, `styles/quick-capture.css`)
Frameless Electron window opened by the global shortcut Ctrl/Cmd+Shift+Space (`electron/main.cjs` loads `/quick-capture`). Studio/Console get this page; soft/river/orbit get their own capture card. Tabs Note / Task (Tab toggles), status line, Cancel/Save.
- Note: first line (leading `#` stripped, max 120 chars, default "Quick note") is the title, the rest the content, tagged `inbox` → POST `/notes`. Save with Ctrl/Cmd+Enter.
- Task: first line parsed with `parseTask` (preview chips show date + 17:00, priority, tags) → POST `/todos`. Enter saves.
- On success shows "Saved to Notes (tagged "inbox")" / "Task added · due …" and calls `window.close()` after 700 ms. Esc closes. On window show/focus the status resets and the box is focused. Requires sign-in (shared token).

### 5.9 AI Hub (`pages/AIHubPage.jsx` + `hooks/useHubChat.js`, `styles/ai-hub.css`; `components/hub/HubScreen.jsx` is the River/Orbit variant)
- Three columns: conversations (New chat, Chats/Connections switch, chat search, groups Today / This week / Earlier, per-chat model + Local/Cloud dot, delete without confirm), chat, sources panel (toggle).
- Chats live only on this device (`peblo-ai-hub-v1`, max 60). Model choice (`peblo-ai-hub-model`): Automatic, any local Ollama chat model (embedding models filtered out), or a configured cloud provider (disabled when routing is `ollama`). The "auto" label: local model if available and routing is `ollama`/`ask` or no cloud; else first cloud model; else "No model".
- Sending: POST `/ai/hub/chat` with `{messages:[{role,content}], noteIds (attached notes), allowCloud, provider?, model?}`, read as SSE (`data: {json}\n\n`). Event types: `sources` (`sources[{n,kind:'note'|'task'|'agenda',id,title,meta,snippet}]`, `searched{notes,tasks}`, `excludedPrivate`), `delta` (text), `done` (`provider, model, local, ms`), `consent` (cloud use needs approval → card "Use a cloud model for this answer?" with "Yes, just this once" = re-run with `allowCloud:true`), `error`. Stop aborts the fetch.
- Answers rendered as Markdown (`renderAnswer`: escapes HTML first, then `marked`, then turns `[n]` into clickable citation pills when n <= number of sources; clicking focuses/scrolls the source). Actions on finished answers: Save as note (POST `/notes` with title = question (80 chars), content = answer + "Sources" list, tag `ai`; navigates to it), Copy, Regenerate. Error card: Try again / Check connections.
- Composer: attach notes by title search (chips), Enter sends, Shift+Enter newline, privacy line ("Runs on this device. Nothing leaves your computer." / "Your question and matching notes go to <model>." / "No AI model is set up yet."). Welcome screen with starters (Plan my day…, What did I write about this week?, Summarise my notes tagged #exams, What should I do first today?) or "Set up a model".
- Deep link: `/ai?q=…[&note=id&noteTitle=…]` starts a new chat (used by Home, Tasks, Console bar, Command Palette, NoteContextPanel).
- Sources panel: "Found by local search: Searched N notes and N open tasks", each source with Open note / Open tasks, footer "N notes tagged #private left out".

### 5.10 Connections (`pages/ConnectionsPage.jsx`, `styles/connections.css`; River/Orbit use `components/hub/ConnectionsScreen.jsx`)
- Routing radio "When Peblo needs AI": `ollama` Local only / `ask` Ask first / `auto` Best available → `updateSettings({defaultAiModel})`, then re-fetch `['hub-models']` after 400 ms. Header badge reflects the routing.
- Local AI (Ollama) switch (`ollamaEnabled` + `ollamaUrl`), address input with Test connection (GET `/ai/ollama/check`) and Save, status line, installed models list with "Default chat"/"Search" badges and "Use for chat" / "Use for search" (sets `ollamaModel` / `ollamaEmbedModel`, stripping `:latest`), install hint.
- Cloud keys: OpenAI and Gemini key fields (password type with show/hide, Save when dirty) → `updateSettings({openAiKey|geminiKey})`; note when routing is Local only.
- Static "Coming next" cards: Peblo MCP Server (Claude Desktop, Cursor, VS Code; "Planned for Peblo 1.2. See docs/03-mcp.md"), Peblo Connect ("Planned for Peblo 1.4"), "What stays private" list.
- `ConnectionsScreen` (River/Orbit) offers the same settings with different copy; its Test connection also saves a changed URL.

### 5.11 Command palette (`components/CommandPalette.jsx`, `styles/command-palette.css`)
Toggled by Ctrl/Cmd+K (window listener), closed by Esc or overlay click. On open it fetches all notes (`GET /notes?sort=updated`). Items: "Ask AI: "<query>"" (when query > 2 chars) → `/ai?q=`; navigation (Home, Notes, Tasks, Calendar, Open AI Hub, AI models and privacy); "Change style to <X>" for the four other styles; up to 5 notes whose title contains the query → `/notes/:id`. Arrow keys + Enter, mouse hover selects. Rendered in a portal on `document.body`.

### 5.12 Settings modal (`components/SettingsModal.jsx`)
Opened from Sidebar/Console/Soft (and via `peblo:open-settings` from River/Orbit). Left nav, close button, overlay click closes. `initialTab='security'` maps to `data`.
- **Profile**: avatar initial, Display Name (required), Job Title / Role, Timezone (`UTC`, `EST`, `PST`, `IST`, `CET` abbreviations), Short Bio, Email (disabled; "Contact support…"). Save → `updateProfile({name, email})` + `updateSettings({jobTitle, bio, timezone})`; "Profile saved successfully!" for 3 s.
- **Appearance**: Style cards (Studio, Console, Soft Studio, River, Orbit; each with description, audience tags and tooltip) → `setUiStyle`; Theme cards Light / Dark / Midnight / System → `setTheme`; Compact Mode toggle (`compactMode`).
- **Preferences** ("Editor Preferences"): Editor Font Size small/medium/large, Note Language en/es/fr/de, Auto-save Interval 1/5/15 min/never, Enable Word Wrap, Auto-suggest Titles (AI). All saved to settings; none is read anywhere else.
- **Notifications**: Product Updates & Marketing (`emailMarketing`), Weekly Activity Digest (`emailActivity`), Task Reminders (`pushReminders`). Saved but not used by the client.
- **AI Providers**: "Default AI Agent" custom dropdown: Auto (OpenAI → Gemini → Local) / OpenAI / Google Gemini / Local AI (Ollama). OpenAI and Gemini key inputs (red "Limit Reached" state when `settings.invalidKeys` includes the provider). Local AI (Ollama) toggle, address + Test connection, chat model and embedding model inputs with a datalist of installed models. "Save AI Settings" → one `updateSettings({openAiKey, geminiKey, defaultAiModel, ollamaEnabled, ollamaUrl, ollamaModel, ollamaEmbedModel})`.
- **Your Data**: explanation cards; Change password (current, new >= 8, repeat; keeps this device signed in with the new token); Sign out everywhere; Import from Notion / Obsidian / Markdown (`.zip,.md,.markdown,.txt,.csv`, multiple) → POST `/import`, result "Imported N notes (… skipped). They're tagged "imported"." then invalidates every query; Export all notes as a `.zip` of Markdown (GET `/export`).
- **Sign out** button in the nav.

### 5.13 Other
- `utils/helpers.js`: `stringToColorClass(tag)` (hash → tag-blue/teal/amber/purple/coral), `stripMarkdown` (removes table pipes/dividers, `#*_~\`>`, link syntax, collapses whitespace), `formatRelativeDate` (Today / Yesterday / N days ago / "Oct 6").
- `RecentAiActivity`, `DashboardTodoItem` — unused.

### 5.14 CSS map (not analysed in depth)
`tokens.css` (design tokens: `--pb-*` palette for Paper/Graphite/Midnight, fonts, radii, heat colours, per-style overrides `[data-style=console|soft|river|orbit]`, and mapping of legacy `--bg-*`/`--text-*`/`--accent*` variables), `canvas.css` (design canvas), `index.css` (reset + legacy design system, buttons, settings modal `.settings-hub-*`), `shell.css` (Studio shell, sidebar, `.pb-*` primitives), `shell-styles.css` (Console/Soft shells), `auth.css` (AuthScreen), `home.css`, `tasks.css`, `workspace.css` (old notes workspace, AI panel, link previews, mobile), `notes.css` (newer notes list/toolbar/context panel, overrides workspace.css), `diff-viewer.css`, `ai-hub.css`, `connections.css`, `command-palette.css`, `quick-capture.css`, `ai-call.css`, `dashboard.css` (legacy dashboard variables + mobile utilities, used by Calendar and TodoListPanel), `calendar.css` + `calendar-pb.css` (calendar, remapped onto tokens), `ai-chat.css` (dead AiChatPanel). Never imported: `todolist.css`, `share-modal.css`, `shared.css`.

---

## 6. Keyboard shortcuts found

| Shortcut | Where | Effect | Source |
|---|---|---|---|
| Ctrl/Cmd+Shift+Space | global (OS) | open/close quick capture window | `electron/main.cjs:40` |
| Ctrl/Cmd+K | anywhere in shell | toggle command palette (except on Notes, see bugs) | `CommandPalette.jsx:21` |
| Esc / ↑ / ↓ / Enter | command palette | close / move / select | `CommandPalette.jsx:25,90` |
| Ctrl/Cmd+J | anywhere except `/notes*` | open AI Hub | `AppShell.jsx:35` |
| Ctrl/Cmd+J | Notes page | toggle note's AI panel | `WorkspacePage.jsx:264` |
| Ctrl/Cmd+S | Notes page | save now | `WorkspacePage.jsx:260` |
| Ctrl/Cmd+K | Notes page | focus notes search (steals palette) | `WorkspacePage.jsx:261` |
| Ctrl/Cmd+N | Notes page | new note (registered twice) | `WorkspacePage.jsx:262,833` |
| Ctrl/Cmd+P | Notes page | toggle read-only "preview" | `WorkspacePage.jsx:263` |
| Ctrl/Cmd+/ | Notes page | focus + select notes search | `WorkspacePage.jsx:837` |
| Enter / Space | notes list row | open note | `NotesSidebar.jsx:162` |
| Enter | tag input | add tag | `WorkspacePage.jsx:568` |
| `/` | block editor | slash menu incl. 4 AI commands | `BlockEditor.jsx:189` |
| ← / → | Calendar | previous / next day | `CalendarPage.jsx:173` |
| N | Calendar | open add-task form (also fires with Ctrl+N) | `CalendarPage.jsx:183` |
| Enter / Shift+Enter | AI Hub composer | send / newline | `AIHubPage.jsx:238` |
| Esc / Tab / Enter / Ctrl+Enter | Quick capture | close / switch Note-Task / save task / save note | `QuickCapturePage.jsx:85` |
| Ctrl/Cmd+Shift+A, Esc, Enter | AiChatPanel (dead) | toggle (only while already open) / close / send | `AiChatPanel.jsx:222` |

Hints shown in UI: "New note (Ctrl+Alt+N)" tooltip (`NotesSidebar.jsx:85`, wrong), editor footer "Ctrl+S save · Ctrl+K search · Ctrl+J ask AI", Welcome "Ctrl+N new / Ctrl+K search / Ctrl+S save", Console status bar "ctrl k commands · ctrl j ask · ctrl shift space capture", default notification "Tip: Use Ctrl + K to quickly focus the search bar."

---

## 7. Bugs, risks, dead code, inconsistencies

### 7.1 Security / privacy
1. **Decrypted API keys cached in plain text on disk.** `GET /profile` returns `settings.openAiKey/geminiKey` decrypted (`server/src/services/profile.ts:19-22`), and `adoptProfile`/`updateSettings` write the whole settings object to `localStorage['peblo-settings']` (`AuthContext.jsx:72,183`). The UI claims keys are "stored encrypted" (`SettingsModal.jsx:587`, `ConnectionsScreen.jsx:132`).
2. **Previous account's data leaks after a forced sign-out.** The `peblo:signed-out` handler (`AuthContext.jsx:99`) only clears `user` and the query cache, not localStorage or in-memory `settings`. If the token expires and a different person signs in on that device, `adoptProfile` merges `{...serverSettings, ...prevLocalSettings}` (`AuthContext.jsx:71`) so the old account's settings (including API keys) win and are shown in Settings/Connections; AI Hub chats (`peblo-ai-hub-v1`) and `peblo_cached_notes` are also shown to the new account.
3. **`peblo_cached_notes` survives even a normal logout** because `logout()` only removes keys starting with `peblo-` (`AuthContext.jsx:122`) while this key uses an underscore (`WorkspacePage.jsx:125`). It holds the full title and content of every note and is used as `initialData` for the next account (`WorkspacePage.jsx:130-141`). Same for `peblo_called_tasks`, `peblo_last_morning_briefing`, `peblo_call_*`.
4. **Local-over-server settings merge** (`AuthContext.jsx:71`): settings changed on another device (e.g. a rotated key or routing) are overridden by this device's stale copy, and any later SettingsModal save pushes the stale values back to the server.
5. **Unsanitised HTML injection** (Electron renderer, same origin as the API token in localStorage):
   - `AiWorkspacePanel.jsx:194` renders AI chat replies with `marked.parse` into `dangerouslySetInnerHTML` (marked passes raw HTML through). Prompt injection via note content or a linked page could inject markup.
   - PDF export sets `container.innerHTML = marked.parse(noteContent)` (`WorkspacePage.jsx:371`); `<img src=x onerror=…>` in a note (e.g. from an import) executes even though the container is detached.
   - HTML / Word exports interpolate `noteTitle` without escaping (`WorkspacePage.jsx:336-338,348,361`).
   - `useHubChat.renderAnswer` escapes HTML first (good) but `marked` still produces `javascript:` links from `[x](javascript:…)` (`useHubChat.js:37`).
6. **Link-preview request on every keystroke.** The effect at `WorkspacePage.jsx:729-790` runs on each `noteContent` change without debounce; while typing a URL each prefix (`https://e`, `https://ex`, …) triggers `GET /ai/link-preview`, i.e. the server fetches arbitrary partial URLs (also an SSRF surface on the server).
7. `window.__simulateVoiceCommand` debug hook is installed in production (`AiVoiceCallModal.jsx:263-273`).

### 7.2 Functional bugs
8. **Ctrl+K never opens the command palette on the Notes page**: `useKeyboardShortcut('k', …)` (`WorkspacePage.jsx:261`) listens in the capture phase and calls `stopPropagation()`, so the palette's bubble listener (`CommandPalette.jsx:19-30`) never sees real keypresses. Clicking "Search or ask…" does open it, because `openCommandPalette()` dispatches directly on `window` (at-target phase), but it also focuses the notes search at the same time. The same capture handler also swallows Ctrl+K inside the BlockNote editor (BlockNote's own link shortcut).
9. **`useKeyboardShortcut` does not check that unspecified modifiers are absent** (`hooks/index.js:117-118`): Ctrl+Shift+S/N/P/J/K also trigger the note shortcuts. Ctrl+P (print) and Ctrl+N are overridden in the editor.
10. **Ctrl+N is registered twice** (`WorkspacePage.jsx:262` and `833`); the second never fires because the capture handler stops propagation. Dead code. Tooltip says "Ctrl+Alt+N" (`NotesSidebar.jsx:85`).
11. **Notes become unopenable after delete/archive/restore in the same session.** `ignoredNoteIdsRef` gets the id added (`WorkspacePage.jsx:519,536,553`) and is never cleared, so the route effect returns early forever for that id (`WorkspacePage.jsx:464`): e.g. restore a note from Trash, switch to All, click it → nothing loads.
12. **Voice-call snooze/decline re-ring with an empty agenda**: `handleSnooze`/`handleDecline` are defined inside a `useEffect(..., [])` and capture the initial `tasks=[]` and `callType='morning_briefing'` (`AiVoiceCallManager.jsx:98,108`).
13. **Voice command invalidates non-existent query keys** `['todayTasks']`, `['insights']`, `['weeklyReport']` (`AiVoiceCallModal.jsx:446-449`); the real keys are `['todos',…]` and `['dashboard',…]`. Lists only refresh if the server emits a socket event.
14. **"Upcoming task" call condition** is `0 < hoursLeft <= 2.1` (comment says 1.9–2.1) (`AiVoiceCallManager.jsx:68`): any task due within 2 h rings, including tasks created minutes before their deadline, and all-day tasks (deadline 23:59) ring at ~21:53. Morning briefing only fires if the app is open between 07:30 and 07:59 and the speech always starts "Good morning!" (also for manual calls). Deadlines at 23:59 are read out as "scheduled for 11:59 PM" (only 00:00 is treated as no time, `AiVoiceCallModal.jsx:361`). The `trigger_ai_call` event is never dispatched anywhere, so a manual call is unreachable. `endCall` calls `window.speechSynthesis.cancel()` without a feature check (`AiVoiceCallModal.jsx:479`).
15. **TanStack Query v5 misuse**: `invalidateQueries(['todos'])` / `invalidateQueries(['notes'])` / `cancelQueries(['todos'])` with a bare array (`AuthContext.jsx:146,150`; `TodoListPanel.jsx:20,27,38,45`). In v5 the argument is a filters object, so an array has no `queryKey` and the call matches every query (each socket event refetches everything). `TodoListPanel` `setQueryData(['todos'], old => old.map…)` throws if the cache is empty (`TodoListPanel.jsx:29-31`).
16. **TodoListPanel ("Tasks" button in a note) shows all tasks** and adds unparsed, unlinked tasks (`TodoListPanel.jsx:11-17`), unlike NoteContextPanel's linked-task list.
17. **Calendar is not live**: it keeps its own state and only reloads on month change or `todo-updated` (dispatched only by the dead AiChatPanel). Changes from socket events, other pages, the voice call or quick capture do not appear until navigation (`CalendarPage.jsx:50-71`).
18. **Calendar Day view navigation**: in Day view the prev/next buttons still change the month and set `selectedDay=null` (`CalendarPage.jsx:266-276`), leaving an empty title and empty timeline.
19. **Calendar drag-and-drop and inline add drop the time**: deadlines are set to 23:59:59.999 of the target day (`CalendarPage.jsx:87-88,136-137`); `startTime`/`endTime` are sent as `''` instead of null when empty (`CalendarPage.jsx:95-96`). Inline edit fires `handleUpdateTask` from both `onSubmit` and `onBlur` (`CalendarPage.jsx:580-587`), which can PATCH twice. The `n` shortcut has no modifier check (fires on Ctrl+N) and only ignores INPUT/TEXTAREA targets (`CalendarPage.jsx:170,183`). Month stats only count the loaded month.
20. **TasksPage timeline**: tasks starting 06:00–06:59 pass the `start >= 6` filter but the timeline starts at 07:00, so they render above it with a negative `top` (`TasksPage.jsx:121,123,239`). Delete has no confirm and no error handling; toggle/remove errors are unhandled promise rejections.
21. **parseTask limitations/bugs** (`utils/parseTask.js`): "next" has no effect unless the weekday is today (`line 30`: `diff += diff === 0 ? 7 : 0`), so "next friday" on a Monday is this Friday; "today"/"tonight" set 17:00 even when it is already later; "tonight" = 17:00; only the first occurrence of each pattern is replaced and later patterns override earlier ones ("today … friday" → Friday); no clock times ("3pm" stays in the text), no numeric dates; weekday words inside other words followed by punctuation (e.g. "monday.com") are consumed.
22. **TodoEditModal timezone bug** (unused component, but would bite if wired up): date shown via `toISOString().split('T')[0]` (UTC) and saved as `new Date('YYYY-MM-DD').toISOString()` (UTC midnight), so in IST the date can shift a day and the time is lost (`TodoEditModal.jsx:20,37`).
23. **formatRelativeDate** (`utils/helpers.js:35-38`) compares only `getDate()`; dates less than 24 h in the future show "Yesterday", and `Math.abs` makes future dates read as "N days ago".
24. **DiffViewer line numbers** are row indexes including padding rows, so numbers skip and do not match real line numbers (`DiffViewer.jsx:138,152`). `onRestore` closes the diff before the confirm dialog result is known (`BackupsPanel.jsx:35-38`).
25. **BlockEditor AI commands**: the placeholder text "AI is processing..." triggers `onChange`, so autosave can persist the placeholder if the AI call takes > 1.5 s (`BlockEditor.jsx:64-66`); errors use `alert()`. Markdown round-trip via `blocksToMarkdownLossy` drops BlockNote-only formatting (colours, alignment, nested structures). Opening an empty note skips parsing, fine, but `editor` content is never reloaded if `initialContent` changes without a key change.
26. **Draft double-create race**: if `POST /notes` for a draft takes longer than the 1.5 s debounce while the user keeps typing, `useAutoSave` will run another save with id `'__draft__'` and create a second note (`hooks/index.js:65-82` + `WorkspacePage.jsx:218-224`).
27. **"Preview" is not a preview**: Ctrl+P only sets `editable=false` on the editor (`WorkspacePage.jsx:997`); there is no rendered preview, despite `marked` being available.
28. **AI insights**: "Extract Action Items" / "Get tasks" only display items; there is no way to turn them into tasks. The 502 error text tells the user to set `GEMINI_API_KEY in server/.env` (`WorkspacePage.jsx:660`), outdated now that keys are per user. Chat Copilot history is lost on note switch.
29. **useHubChat** ignores `res.ok` (`useHubChat.js:142-148`): a non-SSE error response ends as an empty "done" answer; one malformed SSE event (`JSON.parse` at line 159 is not guarded) aborts the stream with "Could not reach Peblo". In React StrictMode dev the `?q=` effect can send the question twice (effect runs twice before `setParams` clears it).
30. **HomePage** reads `weekly.stats.completionRate` without optional chaining (`HomePage.jsx:130`); "Next few days" fetches 4 days and shows max 3 days with tasks.
31. **Sidebar Inbox link** is never shown as active (`className={() => 'pb-nav-link'}`, `Sidebar.jsx:97`), and the Notes link is active for the Inbox URL. Navigating to `/notes` resets any tag/Inbox filter chosen in the list (`WorkspacePage.jsx:110-113`).
32. **Settings that do nothing**: Editor Font Size, Note Language, Auto-save Interval (autosave is hard-coded to 1.5 s), Word Wrap, Auto-suggest Titles, all three Notification toggles, Profile Timezone (abbreviations like `EST`, never used; tasks send the browser's IANA zone). `groqKey`, `huggingFaceKey`, `forceCustomModels`, `isAiDropdownOpen`-adjacent state for them are declared but never rendered or saved (`SettingsModal.jsx:22-25`).
33. **Two inconsistent routing models**: SettingsModal's "Default AI Agent" offers `auto|openai|gemini|ollama` (`SettingsModal.jsx:610-615`) while Connections offers `ollama|ask|auto`. Choosing `ask` in Connections makes the SettingsModal dropdown show nothing selected, and saving the modal then overwrites routing. Sidebar has labels for both sets.
34. `updateProfile` sends the (read-only) email back on every profile save and has no rollback on failure (`SettingsModal.jsx:133`, `AuthContext.jsx:158-167`). Save success messages are shown even if the background PUT fails.
35. **In-app notifications** are seeded with three welcome tips but no UI shows them; `addNotification` is never called; only the voice call reads unread ones aloud (so every morning call reads "Welcome to Peblo Notes! 🎉…").
36. `CommandPalette` matches only lowercase `'k'` (`CommandPalette.jsx:21`) and fetches the full notes list on every open instead of using the query cache; note search is title-only.
37. Theme state read without try/catch (`AuthContext.jsx:17`) unlike the other reads; `setTheme` writes without try/catch (`AuthContext.jsx:176`).
38. `selectNote` navigates with `replace: true` (`WorkspacePage.jsx:449`), so Back does not return to the previously open note.
39. `persistDraft` prepends the new note into every `['notes', …]` cache, including Archive/Trash/tag-filtered lists (`WorkspacePage.jsx:205-208`).

### 7.3 Dead code / leftovers
- Components never imported: `AiChatPanel.jsx` (804 lines, plus `styles/ai-chat.css` and `store/useUIStore.js`), `Heatmap.jsx`, `DonutChart.jsx`, `WritingStreak.jsx`, `RecentAiActivity.jsx`, `AnimatedTabBar.jsx`, `config/navTabs.jsx` (still points Tasks at `/todolist`), `todo/TodoCreateForm.jsx`, `todo/TodoItem.jsx`, `todo/TodoEditModal.jsx`, `dashboard/DashboardTodoItem.jsx`, `calendar/CalendarTaskItem.jsx`.
- CSS never imported: `styles/todolist.css`, `styles/share-modal.css`, `styles/shared.css`.
- Unused API functions: `aiAPI.suggestTag`, `dashboardAPI.toggleTask`; `aiAPI.smartIntake*` and `/ai/chat-stream` only from dead code.
- Unused store fields: `isMobileMenuOpen`, `isShareModalOpen` (no share modal), `noteCategory` has no UI. Unused imports/state in WorkspacePage: `useDebounce`, `useMutation`, `user`, `suggestedTag`, `exportRef`, `isShareModalOpen`, `setShowTodoList` etc.; `EditorToolbar` receives `wordCount` but ignores it; `MobileEditorControls` imports `Link2` and `setIsShareModalOpen` unused.
- Event listeners with no dispatcher: `note-updated` (`WorkspacePage.jsx:281`), `trigger_ai_call` (`AiVoiceCallManager.jsx:112`); `todo-updated` only from dead code.
- Mobile code paths that cannot run on the 1440 px canvas: `canvasWidth() <= 768` checks (`WorkspacePage.jsx:442,810`), swipe handler, `MobileEditorControls`, Welcome mobile header, Calendar mobile panel, `AiChatPanel` `<= 520` check, all `.mobile-only` CSS.
- Unused deps/config: `react-window`, `@tanstack/react-query-devtools`, `tailwindcss` + `@tailwindcss/vite` (plugin not registered), `VITE_GOOGLE_CLIENT_ID` and the COOP/COEP headers in `vite.config.js` (Google sign-in leftovers).
- `AppShell` imports SoftShell/RiverShell/OrbitShell eagerly, so their code ships in the main chunk even for Studio users.
- No TODO/FIXME comments were found in the scoped files; the "Coming next"/"Later" MCP and Peblo Connect cards in ConnectionsPage are the only placeholders.
