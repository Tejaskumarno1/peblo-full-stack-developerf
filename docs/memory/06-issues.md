# 06 · Issue register

Every problem found by the code analysis on 8 Oct 2026 and the verification run on 9 Oct 2026, with its Jira key. **Verdicts (✅ confirmed by running, ⚠️ corrected, ⏸ not testable here) are in [08-verification.md](08-verification.md).** The Jira ticket holds the steps, the fix and the acceptance criteria. Detailed evidence (file:line) is in files 02–05.

When you fix one, change its status here **and** move the Jira ticket. When you find a new one, add a row with the next free ID.

IDs: **S** = security, **B** = bug, **P** = performance, **D** = debt or docs, **G** = missing feature (gap).
Status: Open · In progress · Fixed (commit).

## Security

| ID | Problem | Severity | Jira | Status |
|---|---|---|---|---|
| S-01 | Every desktop install holds the shared MySQL password; anyone with the app's `.env` can read all users' data | Critical | PEB-56 | Open |
| S-02 | **4 Gemini API keys** (`8ac6634` `.env `, `94b8e07`/`4e1c01c` `scratch.js` + `server/scratch.js`, `9ec68f9` `server/src/.env`) and the Supabase DB password in git history | Critical | PEB-55 | Open ✅, needs the owner to revoke all of them |
| S-03 | SSRF through link preview (✅ reads internal pages) and `ollamaUrl`; the Ollama check is *not* a port scanner by message (⚠️) | High (hosted) | PEB-24 | Link preview fixed (this commit); `ollamaUrl` still open |
| S-04 | API keys encrypted with a per-install secret vanish on other machines | High | PEB-58 | Partly fixed (this commit): a saved key that this install cannot read is reported ("can't be read on this computer, enter it again") in Settings, Your AI (all styles) and AI errors, and the models endpoint flags it; tested with a wrong secret. Still open: keys saved on one install still need the same KEY_ENCRYPTION_SECRET on every install (hosted-server decision, PEB-56) |
| S-05 | Decrypted API keys returned to the app and cached in `localStorage` | High | PEB-59 | Fixed (this commit) |
| S-06 | Previous account's notes, keys and chats visible after sign-out on the same computer | High | PEB-60 | Fixed (this commit) |
| S-07 | Unsanitised `marked` HTML in AI replies and exports (script injection) | High | PEB-61 | Fixed (this commit) |
| S-08 | Unbounded uploads and zip bombs held in memory | High | PEB-62 | Fixed (this commit) |
| S-09 | Server AI keys usable by anyone; no AI rate limits | High (hosted) | PEB-26 (comment) | Open |
| S-10 | Rate limits per IP in memory; account enumeration | Medium | PEB-63 | Partly fixed (this commit): sign-in is limited per address (40) and per account (10 failures / 15 min, so faking the address does not help), only failures count, unknown emails cost one bcrypt comparison (similar timing), TRUST_PROXY=true now means one hop. Still open: sign-up still answers 409 for a taken email (needs email verification, PEB-23); limits are in memory (one server); other endpoints are not limited (AI limits are PEB-26) |
| S-11 | AI changes notes and tasks without asking; private and trashed notes sent to AI; "Local only" bypassable | Medium | PEB-64 | Open |
| S-12 | No CSP, DevTools in release, any-localhost trust, debug hook | Medium | PEB-65 | Open |
| S-13 | Raw error text, sockets survive sign-out, unchecked profile fields, 72-byte bcrypt, duplicate route mount (includes S-14) | Low | PEB-66 | Fixed (this commit): unexpected errors answer "Something went wrong" + a reference id (detail only in the log), CORS refusal is 403, sockets are dropped on sign-out-everywhere and password change, profile fields are type/size checked and a new email needs the current password, passwords over 72 bytes are refused, the AI router is mounted once (note actions under /api/notes, the rest under /api/ai; the client voice-command path moved to /api/ai), unknown /api paths answer JSON 404. 12 smoke checks fail on the old code |
| S-15 | Confidential challenge PDF and stray files committed; no LICENSE; MPL-2.0 (BlockNote) and OFL fonts shipped with no NOTICES | Medium | PEB-67 | Open |
| S-16 | Known-vulnerable dependencies: root 14 (2 critical), client 29 (13 high) | High | PEB-99 | Open ✅ |

## Bugs

| ID | Problem | Severity | Jira | Status |
|---|---|---|---|---|
| B-01 | Validation errors return 500 (Zod 4 uses `.issues`, not `.errors`); bad dates give 500; tag array crash | Medium (UI never sends bad input) | PEB-68 | Open ✅ |
| B-02 | `toggle-task` without an `id` marks all of the user's tasks done | High | PEB-69 | Fixed (this commit) |
| B-03 | A fresh install can't start (looks for `server/.env` in the bundle) | Critical | PEB-57 | Open ? |
| B-04 | Intel Mac build likely missing the Prisma engine; tag builds may publish twice | High | PEB-71 | Open |
| B-05 | Migrations: no lock, no recovery, `db:sql` overwrites 001 | High | PEB-72 | Open |
| B-06 | Streak and heatmap off by a day in IST; fake activity for today; overdue capped at 10 | Medium | PEB-73 | Fixed (this commit): day keys in the user's zone, no invented activity, Trash excluded, overdue counted, all AI types labelled. No edit log yet, so only each note's last edit shows |
| B-07 | Server time zone used for "today" | Medium (hosted) | PEB-74 | Fixed (this commit): client sends X-Timezone, server day ranges/greeting/briefing/weekly/smart-intake/Hub use it. Still server-clock: streak/heatmap (PEB-73), recurrence, retrieval/river date labels |
| B-08 | AI failures show fake results and create junk notes | Medium | PEB-75 | Fixed (this commit): no mock results, nothing saved on failure, typed errors (NO_AI_KEY, PROVIDER_ERROR 502, TIMEOUT), 60 s provider timeouts. Streaming chat and background helpers (embeddings, tags) not changed |
| B-09 | Repeating tasks: now one series (`todo_series`, migration 003) that tops itself up as tasks are listed (60 days ahead, never runs out); monthly/yearly clamp to the last day of short months; edit/delete "this / this and following / all"; "every weekday" added. Older copied tasks stay plain tasks. Not done: RRULE weekdays/intervals, virtual occurrences, the dashboard does not top up | Medium | PEB-76 (story) | Fixed ? |
| B-10 | Missing socket events; React Query v5 invalidation misuse; Calendar not live | Medium | PEB-77 | Fixed (this commit): every write path emits events, query keys corrected, Calendar refreshes on 	odos_changed; socket regression in smoke test. Calendar still uses local state, not React Query |
| B-11 | Notes can't be reopened after delete/archive/restore; draft double-create; placeholder autosaved (includes B-13) | High | PEB-70 | Fixed (this commit); e2e in `e2e/` |
| B-12 | Ctrl+K broken on Notes; shortcuts ignore extra modifiers | Medium | PEB-78 | Fixed (this commit) |
| B-14 | Calendar: Day view arrows, drag drops the time, double save | Medium | PEB-79 | Fixed (this commit); e2e/calendar.mjs. Month statistics still count only the loaded month |
| B-15 | Task parser: "next friday", no clock times; Soft 17:00 vs all-day elsewhere (includes B-21) | Medium | PEB-80 | Fixed (this commit): shared parser with times, next-week weekdays, month/ISO dates, all-day = 23:59 in every style; 31 unit tests. Slash dates (12/10) deliberately unsupported (ambiguous) |
| B-16 | Voice call: empty agenda on snooze, rings at 21:53 for all-day tasks, no refresh | Medium | PEB-81 | Open |
| B-17 | Settings that do nothing; two routing lists | Medium | PEB-82 | Fixed (this commit): dead settings removed (note language, auto-save interval, word wrap, auto-suggest titles, notification tab, time zone picker, unused Groq/HuggingFace state, seeded tips), editor text size now works, one routing list (Only on this computer / Ask me first / Best available) shared by Settings, Your AI in every style, sidebar and console status, profile/settings saves report real errors and no longer send the email, saving keys no longer overwrites routing. Time zone: Peblo follows the computer's zone |
| B-18 | Version history only for AI edits; unpruned; unsafe restore; trash never emptied | Medium | PEB-83 (story) | Open |
| B-19 | Orbit: quiz counted twice, "was X%" wrong, unquizzed topics dropped | Medium | PEB-84 | Fixed (this commit): server claims the run atomically (409 on repeat), result carries `before`, unquizzed topics stay in the path, number keys bounded, error messages. Not done: quiz-size copy, space picker label, per-open quiz parsing, missed-concept history |
| B-20 | River: all-day becomes 22:00, duplicate promises, hidden items, no delete | Medium | PEB-85 | Partly fixed (this commit): Move keeps all-day, drawer Delete, promises keep added/ignored state, atomic promise updates, todoId ownership, move/delete errors shown. Still open: hidden rows / +N more, wrong scroll after Jump, midnight QuickAdd, other River error handling, brief date |
| B-22 | Small UI defects (link preview per keystroke, Hub hides errors, timeline, sidebar, breadcrumb squeezed to 2 px…) | Low | PEB-86 | Fixed (this commit): link preview waits 800 ms and skips half-typed URLs, Hub shows server errors and survives bad stream events, no double ?q= send, timeline starts at 06:00, delete asks first, task actions show errors, Home null-guard, sidebar Inbox highlight, "Create tasks" from action items, capture window follows style/theme changes, theme storage guarded. Not reproduced: Ctrl+J in other styles (works). Not changed: breadcrumb width, Home "next days" fetches 4 days on purpose. TodoListPanel has no button that opens it, so its fix is defensive |
| B-23 | Probable light flash on start for dark themes (inferred) | Low | PEB-102 | Open ⏸ |
| B-24 | Focus ring faint, missing on active nav link and in high-contrast mode | Medium | PEB-120 | Open ✅ |

## Performance

All five are tracked in **PEB-28** (comment) and PEB-93.

| ID | Problem |
|---|---|
| P-01 | Hub retrieval loads every note's full text on every question |
| P-02 | Notes list without `limit` returns everything; `LIKE` search with no FULLTEXT index |
| P-03 | Dashboard counts in JavaScript; voice prompts include every task and note |
| P-04 | Extra auth DB query per request (doubled on duplicate routes); AI clients rebuilt per call; long provider timeouts |
| P-05 | Import is one-by-one with no transaction; key scan of all users on every start; tag race |
| P-06 | 1.2 MB editor chunk, 34 eager font weights, unbundled server shipping all `node_modules` (**PEB-103**) |

## Debt and docs

| ID | Problem | Jira | Status |
|---|---|---|---|
| D-01 | Dead components, CSS, packages and mobile paths | PEB-88 | Open |
| D-02 | README and docs describe the old SQLite app; `.env.example` incomplete | PEB-87 | Open |
| D-03 | No type-check; CI runs no tests; tests write to whatever DB `.env` names | PEB-31 (comment) | Open |
| D-04 | Deprecated Gemini SDK, hard-coded models, unused key slots and embeddings | PEB-89 | Open |
| D-05 | Five styles differ in core features; duplicated logic; style not saved to the account | PEB-90 | Open ✅ |
| D-06 | GitHub default branch `main` is the old web app; stale `desktop-app` branch | PEB-100 | Open ✅ |
| D-07 | CSS debt: 598 hard-coded colours, 186 `!important`, z-index clash, undefined token, ~312 unused classes | PEB-101 | Open |

## Gaps (planned in the docs, not built)

| ID | Feature | Jira |
|---|---|---|
| G-01 | Public share link (the one challenge requirement not met) | PEB-91 |
| G-02 | Native desktop reminders | PEB-92 |
| G-03 | Review before AI saves; action items → tasks; smart intake reachable | PEB-94 |
| G-04 | Semantic + full-text search for the AI Hub | PEB-93 |
| G-05 | MCP server for other AI tools | PEB-95 |
| G-06 | Auto-update and code signing | PEB-96 |
| G-07 | Full data export (tasks, .ics, settings) and task import | PEB-97 |
| G-08 | `[[links]]` and backlinks (title-match backlinks already exist: Partial) | PEB-98 |
| G-09 | Server out of Electron's main process (TRD D5) | PEB-104 |
| G-10 | Lossless note storage (TRD D8) | PEB-105 |
| G-11 | AI off switch (HUB-12, P0) | PEB-106 |
| G-12 | Peblo Connect: use other MCP servers (CON-01…06, P0/P1) | PEB-107 |
| G-13 | Opt-in crash reports (PLAT-04, P0) | PEB-108 |
| G-14 | First-run onboarding (PLAT-10, P0) | PEB-109 |
| G-15 | Inbox triage (CAP-03) | PEB-110 |
| G-16 | Attachments (KN-06, CAP-07) | PEB-111 |
| G-17 | Calendar sync / .ics (ACT-06) | PEB-112 |
| G-18 | Any OpenAI-compatible provider (HUB-08) | PEB-113 |
| G-19 | Scheduled AI automations (HUB-09) | PEB-114 |
| G-20 | Editable prompt library (HUB-10) | PEB-115 |
| G-21 | Local model guidance and install (HUB-13) | PEB-116 |
| G-22 | CLI (PLAT-05) | PEB-117 |
| G-23 | Phase 2: local vault + E2E sync decision (DATA-05/06/07, ADR-2/4/7) | PEB-118 |
| G-24 | Phase 2: mobile (PLAT-07) | PEB-119 |
| — | Password reset, email verification, account deletion, chat history on the server, deployment, backups, CI, unit tests, accessibility, responsive | PEB-22…34 (created earlier) |

The longer list of about 60 planned items (by PRD requirement ID) is in `05-platform.md` §6.2.

## Suggested order

1. **This week (owner):** revoke all four leaked Gemini keys and the DB password (PEB-55), then purge them and the PDF from history and fix the default branch in one force-push (PEB-67, PEB-100).
2. **Before anyone outside uses the app:** PEB-56, PEB-57, PEB-58, PEB-59, PEB-60, PEB-61, PEB-62, PEB-24, PEB-26, PEB-74, PEB-29.
3. **Quick wins for new developers:** PEB-68, PEB-69, PEB-70, PEB-78, PEB-86, PEB-88.
4. **Then:** quality (PEB-31, PEB-72, PEB-75, PEB-77), then features (PEB-91, PEB-92, PEB-93, PEB-94).
