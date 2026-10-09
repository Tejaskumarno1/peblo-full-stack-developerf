# Peblo client: runtime verification against a mock API

Date: 2026-10-09. Target: the production Vite build in `scratchpad/ui/dist`, driven by Playwright 1.56 (Chromium) at 1440×900, time zone `Asia/Kolkata`, locale `en-IN`. The repo was not modified.

Everything lives in `scratchpad/ui/`:

| File | Purpose |
|---|---|
| `mock-server.mjs` | Static and SPA server plus an in-memory mock API |
| `lib.cjs` | Shared Playwright helpers |
| `step2-shots.cjs` | Step 2 screenshot sweep (output `step2-results.json`) |
| `step3a.cjs` | Claims B-11, B-11b, B-12, B-22a and B-14 (outputs `step3a-*.json`) |
| `step3b.cjs` | Claims S-05/06, S-07, B-19, B-20, B-17 and style parity (outputs `step3b-*.json`) |
| `a11y-audit.js` + `step4-a11y.cjs` | Accessibility sweep (output `step4-results.json`) |
| `shots/` | 58 PNGs |

## 1. How the mock was built, and what it cannot show

**What the mock is**
- `mock-server.mjs` uses Node `http` only. It serves `dist/` and sends every non-`/api` GET to `index.html`. `/socket.io` returns 404 on purpose.
- It implements the endpoints the client calls, with response shapes taken from `client/src/api/index.js`, the pages, and `docs/memory/02-server.md` and `04-ui-styles.md`:
  - auth: signup, login, change-password, logout-all
  - `GET`/`PUT /profile`
  - notes: CRUD, a two-stage delete (trash first, then permanent), restore, archive toggle, backups and revert
  - AI on notes: summary, actions, title, tags, block, voice
  - `/ai/chat`, which returns a `reply` the test controls
  - `/ai/link-preview`, `/ai/ollama/check`
  - `/ai/hub/models|search|chat`. Chat is SSE with `sources` → `delta`* → `done`, in the same `data: {json}\n\n` framing the server uses.
  - dashboard: insights (a 53-week heatmap), daily-briefing, weekly-report
  - todos: CRUD, `today` and `range`
  - study: mastery, quiz, answers and note questions. The mastery update uses the real formula, `prev*0.4 + pct*0.6`.
  - river: promises, brief, find-promises, PATCH promise
  - `/export` (an empty zip) and `/import`

**Seed data** (modelled on `scripts/seed.ts`)
- **Account A** (`tejas@test.com`):
  - 18 named notes plus 27 daily logs. One is tagged `#private`, one is archived and one is in the trash.
  - 20 todos: overdue, today (timed and an all-day 23:59 one), upcoming with `startTime`/`endTime`, undated and done, all with `todoTags`.
  - 3 mastery topics and 1 promise generation.
  - `settings.openAiKey = 'sk-mock-PLAINTEXT-1234'`, which matches the real server returning the decrypted key.
- **Account B** (`other@test.com`) has different settings (`geminiKey: 'gm-USERB-0000'`, `defaultAiModel: 'ollama'`, no OpenAI key) and only 1 note and 1 task.
- Tokens are `tok-<userId>`.

**Control endpoints (no auth)**
- `GET /__requests` returns every API request with method, path, query, time, body and user.
- `POST /__reset` and `POST /__clear`.
- `POST /__set` sets `chatReply`, `hubAnswer`, `fail401Once` and `delayNotesMs`.
- `POST /__note` injects a note.

**Limits**
- **No server logic is under test.** Search ranking, retrieval and `#private` exclusion, socket events, rate limits, time-zone handling, real AI providers and real link scraping are not exercised. Server-side claims were not tested here.
- **No socket.io.** Every page logs 2–3 `404` console errors from socket.io polling. These are mock noise and are excluded below. Live sync after socket events (for example the Calendar not refreshing) could not be tested.
- **Voice-call ringer silenced.** To keep screenshots clean, the test sets `peblo_called_tasks` (every todo id) and `peblo_last_morning_briefing` before boot, so the "incoming call" modal never fires. These two keys show up in the S-06 storage lists because of that.
- **Font aborts are a test artifact.** The 3 font `ERR_ABORTED` "failures" on the first route of each run come from navigating away from the page the test used to set localStorage.
- **Quiz content is fake.** The mock always returns 3 fixed questions, so quiz text is not meaningful.
- **Server-side downloads are not inspected.** For PDF and export, only the client-side behaviour was observed.

## 2. Claims

| ID | Verdict | Evidence |
|---|---|---|
| **B-11** restored note can't be reopened (`ignoredNoteIdsRef`) | **CONFIRMED** (and worse than described) | See note B-11 below the table. |
| **B-12** Ctrl+K on Notes; Ctrl+K on Home; Ctrl+Shift+S saves | **CONFIRMED** | See note B-12 below the table. |
| **B-22a** link-preview request on every keystroke | **CONFIRMED** | Typing `https://example.com` one character at a time (120 ms apart) into a note produced **10** `GET /api/ai/link-preview` requests, one for each prefix: `https://e`, `https://ex` … `https://example.com`. |
| **B-14** Day view navigation; drag drops the time | **CONFIRMED** | See note B-14 below the table. |
| **S-06** what's left after sign-out; data leaking to the next account | **CONFIRMED** | See note S-06 below the table. |
| **S-05** plaintext key in `peblo-settings` | **CONFIRMED** | Right after a UI sign-in, `peblo-settings` = `{"openAiKey":"sk-mock-PLAINTEXT-1234","geminiKey":"","defaultAiModel":"auto",…}`. |
| **S-07** HTML injection | **CONFIRMED (all 3 parts)** | See note S-07 below the table. |
| **B-19** quiz answers submitted repeatedly; "was X%" | **CONFIRMED** (for Enter) | See note B-19 below the table. |
| **B-20** River Move on an all-day task; no delete | **CONFIRMED** | See note B-20 below the table. |
| **B-17** settings that do nothing; two routing models | **CONFIRMED**, with one exception | See note B-17 below the table. |
| **Style parity** | See table below | Checked in the UI and confirmed by grep. |

**B-11**
- **Steps:** open `/notes/note-acid`, move it to Trash (confirm dialog), open the Trash tab, Restore, then the All tab.
- **The restored note is not in the All list at all.** After restore, `rowVisibleInAllRightAfterRestore = 0`. It is still missing after going Home and back to Notes, and after toggling the Trash and All chips, even though the server says `isDeleted:false`.
  - Cause: `handleRestoreNote` removes the note from every `['notes',…]` cache and never invalidates (`WorkspacePage.jsx:534-541`). The 5-minute `staleTime` keeps the list stale.
- **Variant B-11b**, which tests the ref directly:
  - Delete a note, open Trash, click that note: the URL becomes `/notes/note-acid` but the editor shows "Choose a note to open" (title `null`). An untouched trashed note ("Scratch note") opens normally.
  - Archive "OS · Deadlocks", open Archive, click it: the URL changes to `/notes/note-deadlock` but nothing loads. The control ("Old resume draft") opens.
  - After Unarchive, the note is also missing from All.
- A full reload, or any route that remounts `WorkspacePage`, opens it again. In this test that was a `pushState` from `/notes` to `/notes/:id`, which mounts a fresh instance.
- Screenshots: `claim-B11-missing.png`, `claim-B11b.png`.

**B-12**
- **Ctrl+K on `/notes`:**
  - Studio and Console: the palette does **not** open (0 found) and focus goes to `INPUT#search-input`.
  - Soft, River and Orbit: it opens.
- **Ctrl+K on Home:** it opens in all 5 styles.
- **Ctrl+K inside the Studio editor:** no palette; focus jumps to `#search-input`.
- **The sidebar "Search or ask…" button on Notes** does open the palette.
- **Ctrl+Shift+S** after typing one character: `PATCH /api/notes/note-dbms` fired **+19 ms** after the key press, long before the 1.5 s autosave. Plain Ctrl+S gave +20 ms.

**B-14**
- **Day view:** the label reads "Friday, October 9". Pressing **Next** gives an **empty title**, an empty timeline (0 tasks), "0 tasks · 0 done", and the sidebar shows "Select a day". `currentDate` jumps to the next month and `selectedDay` becomes null (`CalendarPage.jsx:266-276`). Screenshot: `claim-B14-day-next.png`.
- **Drag:** dragging "Standup with the team" (start 09:00, end 09:30) from the sidebar to the 12th sent `PATCH /api/todos/todo-morning` with body `{"deadline":"2026-10-12T18:29:59.999Z","timezone":"Asia/Calcutta"}`. That is 23:59:59.999 IST.
  - `startTime`/`endTime` are **not** sent, so the stored task now has deadline 23:59 but `startTime` "09:00".
  - It is an all-day deadline with a leftover start time, which River and Orbit interpret as a 09:00 meeting.

**S-06**
- **(a) Sign out through Settings:** the keys left are
  - `peblo_cached_notes`: 15,754 characters, the full title and content of every note
  - `peblo_called_tasks`
  - `peblo_last_morning_briefing`

  The theme and style keys were never written in this run.
- **(b) Forced sign-out:** `fail401Once`, then clicking Tasks shows the auth screen. Keys left:
  - `peblo-settings` (with `sk-mock-PLAINTEXT-1234`)
  - `peblo-ai-hub-v1` (the chat "Plan my day")
  - `peblo-ai-hub-model`
  - `peblo_cached_notes`, `peblo_called_tasks`, `peblo_last_morning_briefing`
- **(c) Then sign in as `other@test.com`:**
  - `peblo-settings` still holds **account A's** settings (`openAiKey: sk-mock-PLAINTEXT-1234`, `defaultAiModel: auto`). B's server settings (`gemini` key, `ollama` routing) lose the merge.
  - Settings → AI Providers shows the OpenAI key field filled with **`sk-mock-PLAINTEXT-1234`** and "Auto (OpenAI → Gemini → Local)". Screenshot: `claim-S06-userB-settings-ai.png`.
  - The Notes list shows **account A's notes** (Internship · weekly log, DBMS…) while B's `/notes` request is in flight (mock delay 2.5 s). Screenshot: `claim-S06-userB-notes-cached.png`.
  - The AI Hub shows A's chat "Plan my day" to B.
  - No PUT was sent back automatically. A's settings would reach B's account only if B saved Settings or Connections.

**S-07**
- **(1) Note AI panel → Chat Copilot,** with the reply `Hello <img src=x onerror=…>`: the bubble HTML is `<p>Hello <img src="x" onerror="window.__xss=(window.__xss||0)+1"></p>` and **`window.__xss = 1`**.
- **(2) AI Hub,** with an answer containing `[click](javascript:window.__xss2=1)`: it rendered `<a href="javascript:window.__xss2=1">click</a>`. Clicking it gave **`window.__xss2 = 1`**. A raw `<img onerror>` in the hub answer was escaped (`__xss2b` stayed null; no img rendered).
- **(3) PDF export:** a note containing `<img src=x onerror="window.__xss3=1">` had `__xss3` = null before export. After More → Export as PDF, **`__xss3 = 1`** and `XSS_test.pdf` was downloaded.

**B-19**
- **Pressing Enter 3 times on the last question:** **3** `POST /api/study/quiz/:id/answers` requests. Server mastery `quizzes` went from 2 to 5, and the score moved 3 times.
- **Clicking "See my score" 3 times:** only **1** POST. The button disappears after the first click.
- **The result screen says "68% mastered · was 68%"**, so "was" shows the **new** score, not 80%.
  - The header showed "80% MASTERED BEFORE" before the quiz.
  - The same happened on the second run ("47% mastered · weak was 47%").

**B-20**
- Selected "Lossless-join check for example 2" (deadline 23:59, no `startTime`). The drawer reads "Task · due in 9 h … Due today".
- **Move** pre-fills day `2026-10-09` and time **22:00**. Saving without changes sends `{"deadline":"2026-10-09T16:30:00.000Z"}`, which is 22:00 IST. The all-day task becomes a 22:00 task. Screenshot: `claim-B20-move.png`.
- **No delete action** appears in River on `/`, `/tasks` or `/calendar`, either in the drawer or on the river. The only matches were the word "bin" inside "round robin" and the Notes "Trash" filter.
- A grep agrees: `client/src/river/*` never calls `todosAPI.delete`.

**B-17**
- **Font size:** with Settings → Preferences → Editor Font Size = large (stored as `fontSize: "large"`), the editor text is **15 px** both before and after.
- **Routing:** choosing "Ask first" in Connections sends `PUT {settings:{defaultAiModel:"ask"}}`. Settings → AI then shows the "Default AI Agent" box with **no option label**, only the help text. Screenshot: `claim-B17-settings-ai.png`.
- **Exception (NOT REPRODUCED):** "saving the modal overwrites routing" did not happen. "Save AI Settings" sent `defaultAiModel:"ask"` unchanged, because the modal's state is initialised from settings. Routing would only change if the user picks an option.

**Style parity**

| Style | (a) delete a task | (b) note version history | (c) search notes |
|---|---|---|---|
| Studio | yes: TasksPage `Delete "…"` and Calendar | yes: "History" / More → Version history | yes: "Search notes" |
| Console | yes (same pages) | yes | yes |
| Soft | yes: SoftTasks | yes: "2 versions kept" (`SoftNotes.jsx:389`) | **no**: no search box on `/notes`; only the Ctrl+K palette (titles only) |
| River | **no** (see B-20) | **no** | yes: "Search titles, tags and text…" |
| Orbit | yes: OrbitDue (with confirm) | **no** | yes: "Search notes…" |

## 3. Console errors and failed requests per style and route

Format: `socket.io 404 console errors / page errors / failed requests (non-socket)`. "→" marks a redirect.

| Route | studio | console | soft | river | orbit |
|---|---|---|---|---|---|
| `/` | 2/0/0 | 3/0/3 | 2/0/3 | 2/0/3 | 2/0/3 |
| `/notes` | 2/0/0 | 3/0/0 | 3/0/0 →/notes/note-intern | 2/0/0 | 2/0/0 |
| `/notes/note-dbms` | 3/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |
| `/tasks` | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |
| `/calendar` | 3/0/0 | 3/0/0 | 3/0/0 | 2/0/0 | 2/0/0 |
| `/ai` | 2/0/0 | 2/0/0 | 2/0/0 | 3/0/0 | 2/0/0 |
| `/ai/connections` | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 | 2/0/0 |
| `/quick-capture` | 2/0/0 | 2/0/0 | 3/0/0 | 2/0/0 | 2/0/0 |
| `/quiz/dbms` | n/a | n/a | n/a | n/a | 2/0/0 |

- **Every console error was a socket.io 404.** No uncaught page errors and no 4xx/5xx API responses occurred on any route.
- **The "3 failed requests" on `/`** are the 3 font loads aborted by the test's first navigation (artifact).
- **Rendered text** was also scanned on all 40 style/route pages for `NaN`, `undefined`, `Invalid Date`, `[object Object]` and `null%`: none found.
- **Other console output:**
  - During S-07 the PDF export logged `Error loading image http://127.0.0.1:4173/notes/x`. That is html2canvas loading the injected image.
  - Soft `/notes` auto-opens the latest note (`/notes/note-intern`).
- Screenshots are in `shots/<style>-<route>.png`: 41 files, plus the claim and a11y shots.

## 4. Accessibility sweep

Light theme, Home and Notes in each style, plus Studio in dark theme. "Unnamed interactive" means no `aria-label`, `aria-labelledby`, `<label>`, text, title or img alt. "Unlabelled fields" counts inputs, textareas and selects with no label, `aria-label` or title; placeholder-only counts as unlabelled.

| Page | Interactive | Unnamed | Unlabelled fields | img without alt | tabindex>0 | Normal text checked | Below 4.5:1 | Large text below 3:1 |
|---|---|---|---|---|---|---|---|---|
| studio home | 38 | 0 | 0 | 0 | 0 | 110 | 0 (0%) | 0 |
| studio notes | 73 | 0 | 0 | 0 | 0 | 288 | 0 (0%) | 0 |
| console home | 33 | 0 | 0 | 0 | 0 | 85 | 0 (0%) | 0 |
| console notes | 68 | 0 | 0 | 0 | 0 | 263 | 0 (0%) | 0 |
| soft home | 29 | 0 | 0 | 0 | 0 | 37 | 0 (0%) | 0 |
| soft notes | 72 | 0 | 0 | 0 | 0 | 158 | 1 (0.6%) | 0 |
| river home | 68 | 0 | 0 | 0 | 0 | 769 | 9 (1.2%) | 0 |
| river notes | 66 | 0 | 0 | 0 | 0 | 249 | 0 (0%) | 0 |
| orbit home | 42 | 0 | 0 | 0 | 0 | 67 | 0 (0%) | 0 |
| orbit notes | 67 | 0 | 0 | 0 | 0 | 200 | 0 (0%) | 0 |
| studio home **dark** | 38 | 0 | 0 | 0 | 0 | 110 | 0 (0%) | 0 |
| studio notes **dark** | 73 | 0 | 0 | 0 | 0 | 288 | 0 (0%) | 0 |

**Worst contrast examples** (all failures found: 10 in total)

| Selector | Text | Foreground / background | Ratio |
|---|---|---|---|
| river home `button.r-meet > span.m` | "9–9:30 am" (past meeting) | #8495d2 / #dce4ff | **2.31** |
| river home `button > span.m` (×3) | "done" | #9ba0a5 / #ffffff | 2.64 |
| river home `button.r-meet > span.t` | "Standup with the team" | #7487ca / #dce4ff | 2.75 |
| river home `span.r-now-pill` | "NOW" | #ffffff / #e2501a | 3.89 |
| river home `button > span.t` (×3) | done task titles | #7c7e80 / #ffffff | 4.09 |
| soft notes `span.txt > span.m` | "Just now" | #6e6559 / #cfe5f8 | 4.42 |

Studio's lowest passing values are the `pb-kbd` hints at 4.66 (light) and 4.82 (dark), then `pb-muted` times on amber cards at 4.75. Console's lowest is 5.24 and Orbit's is 5.73.

**Caveats on the contrast numbers**
- The method computes the text colour against the first opaque ancestor background, alpha-blended, with ancestor opacity multiplied in.
- Placeholder text, SVG icon contrast, text over gradients or images (none were found on these pages), and hover/focus states were **not** measured.

**Focus indicator** (Studio Home, 3 Tab stops; `shots/a11y-studio-home-tab{1,2,3}.png`)

| Tab stop | Ring | `:focus-visible` |
|---|---|---|
| 1. "Collapse sidebar" | 3 px ring, `rgba(79,70,229,0.28)` | true |
| 2. "Search or ask…" | the same ring | true |
| 3. "Home" nav link | **no ring visible**; the computed box-shadow is the `.active` card shadow | true |

- **Cause of the missing ring:** `.pb-nav-link.active { box-shadow: var(--pb-shadow) }` (`styles/shell.css:152-157`) is more specific than the global `:focus-visible { outline:none; box-shadow: var(--pb-focus) }` (`styles/tokens.css:173-177`). Keyboard users lose the focus ring on the current page's nav link.
- **The ring itself is faint.** It is indigo at 28% alpha on #f1efea, which works out to roughly **1.6:1** against the sidebar. That is below the 3:1 non-text contrast guideline (WCAG 1.4.11).
- **The ring disappears in forced-colors mode.** It is drawn only with box-shadow under `outline:none`, and box-shadow is dropped in forced-colors / Windows High Contrast.

## 5. New bugs noticed

1. **Restore or unarchive never brings the note back into All** in Studio and Console without a reload. `handleRestoreNote` and `handleArchiveNote` only remove the id from every cached `['notes',…]` list and never invalidate (`client/src/pages/WorkspacePage.jsx:534-541`, `:551-558`; 5-minute `staleTime` in `main.jsx`). This makes B-11 unreachable by clicking at all, since there is nothing to click.
2. **A trashed or archived note can't be opened from the Trash or Archive view either.** `ignoredNoteIdsRef` blocks it there too (`WorkspacePage.jsx:464`, `:519`, `:553`). This is the same root cause as B-11, but it shows up even without restoring.
3. **Calendar drag leaves inconsistent task data:** deadline 23:59:59.999 but `startTime`/`endTime` kept (`CalendarPage.jsx:136-143` sends only `deadline`). River and Orbit then treat the task as a meeting at the old start time on the new day.
4. **The Studio note breadcrumb title is collapsed to about 2 px.** It shows "Notes / #dbms / |". `.nt-crumbs .cur` has `min-width:0; overflow:hidden` and the crumb container is only 111 px wide next to the right-hand toolbar (`client/src/styles/notes.css:72-74`, `components/workspace/EditorToolbar.jsx:61-66`). Visible in `shots/studio-note.png`.
5. **The keyboard focus ring is hidden on the active Studio nav link,** and the ring is low-contrast and box-shadow only. See §4 (`styles/shell.css:152`, `styles/tokens.css:173`).
6. **The Settings → Preferences font-size select** saves `fontSize` to settings and the server, but nothing reads it. This confirms B-17. Auto-save interval, word wrap and the others were not individually tested.
7. **River's past-meeting and "done" labels fall to 2.3–2.75:1 contrast** (`river.css` muted and meeting colours). This may be intentional de-emphasis but fails WCAG AA.

**Untestable here:** server-side behaviour (private-note exclusion, SSRF in link preview, time zones), socket-driven live updates, Electron-only features (the quick-capture window and global shortcut, zoom), the voice call (deliberately silenced), and the real contents of the PDF/zip.
