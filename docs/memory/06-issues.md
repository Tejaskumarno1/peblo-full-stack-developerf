# 06 · Issue register

Every problem found by the code analysis on 8 Oct 2026, with its Jira key. The Jira ticket holds the steps, the fix and the acceptance criteria. Detailed evidence (file:line) is in files 02–05.

When you fix one, change its status here **and** move the Jira ticket. When you find a new one, add a row with the next free ID.

IDs: **S** = security, **B** = bug, **P** = performance, **D** = debt or docs, **G** = missing feature (gap).
Status: Open · In progress · Fixed (commit).

## Security

| ID | Problem | Severity | Jira | Status |
|---|---|---|---|---|
| S-01 | Every desktop install holds the shared MySQL password; anyone with the app's `.env` can read all users' data | Critical | PEB-56 | Open |
| S-02 | Gemini API key and Supabase DB password in git history (commit `9ec68f9`) | Critical | PEB-55 | Open, needs the owner to revoke them |
| S-03 | SSRF through link preview, Ollama check and `ollamaUrl` | High (hosted) | PEB-24 (comment) | Open |
| S-04 | API keys encrypted with a per-install secret vanish on other machines | High | PEB-58 | Open |
| S-05 | Decrypted API keys returned to the app and cached in `localStorage` | High | PEB-59 | Open |
| S-06 | Previous account's notes, keys and chats visible after sign-out on the same computer | High | PEB-60 | Open |
| S-07 | Unsanitised `marked` HTML in AI replies and exports (script injection) | High | PEB-61 | Open |
| S-08 | Unbounded uploads and zip bombs held in memory | High | PEB-62 | Open |
| S-09 | Server AI keys usable by anyone; no AI rate limits | High (hosted) | PEB-26 (comment) | Open |
| S-10 | Rate limits per IP in memory; account enumeration | Medium | PEB-63 | Open |
| S-11 | AI changes notes and tasks without asking; private and trashed notes sent to AI; "Local only" bypassable | Medium | PEB-64 | Open |
| S-12 | No CSP, DevTools in release, any-localhost trust, debug hook | Medium | PEB-65 | Open |
| S-13 | Raw error text, sockets survive sign-out, unchecked profile fields, 72-byte bcrypt, duplicate route mount (includes S-14) | Low | PEB-66 | Open |
| S-15 | Confidential challenge PDF and stray files committed; no LICENSE | Medium | PEB-67 | Open |

## Bugs

| ID | Problem | Severity | Jira | Status |
|---|---|---|---|---|
| B-01 | Validation errors return 500 (Zod 4 uses `.issues`, not `.errors`); bad dates give 500; tag array crash | High | PEB-68 | Open (confirm by running) |
| B-02 | `toggle-task` without an `id` marks all of the user's tasks done | High | PEB-69 | Open |
| B-03 | A fresh install can't start (looks for `server/.env` in the bundle) | Critical | PEB-57 | Open |
| B-04 | Intel Mac build likely missing the Prisma engine; tag builds may publish twice | High | PEB-71 | Open |
| B-05 | Migrations: no lock, no recovery, `db:sql` overwrites 001 | High | PEB-72 | Open |
| B-06 | Streak and heatmap off by a day in IST; fake activity for today; overdue capped at 10 | Medium | PEB-73 | Open |
| B-07 | Server time zone used for "today" | Medium (hosted) | PEB-74 | Open |
| B-08 | AI failures show fake results and create junk notes | Medium | PEB-75 | Open |
| B-09 | Repeating tasks are 30 copies, monthly dates overflow, no series edit | Medium | PEB-76 (story) | Open |
| B-10 | Missing socket events; React Query v5 invalidation misuse; Calendar not live | Medium | PEB-77 | Open |
| B-11 | Notes can't be reopened after delete/archive/restore; draft double-create; placeholder autosaved (includes B-13) | High | PEB-70 | Open |
| B-12 | Ctrl+K broken on Notes; shortcuts ignore extra modifiers | Medium | PEB-78 | Open |
| B-14 | Calendar: Day view arrows, drag drops the time, double save | Medium | PEB-79 | Open |
| B-15 | Task parser: "next friday", no clock times; Soft 17:00 vs all-day elsewhere (includes B-21) | Medium | PEB-80 | Open |
| B-16 | Voice call: empty agenda on snooze, rings at 21:53 for all-day tasks, no refresh | Medium | PEB-81 | Open |
| B-17 | Settings that do nothing; two routing lists | Medium | PEB-82 | Open |
| B-18 | Version history only for AI edits; unpruned; unsafe restore; trash never emptied | Medium | PEB-83 (story) | Open |
| B-19 | Orbit: quiz counted twice, "was X%" wrong, unquizzed topics dropped | Medium | PEB-84 | Open |
| B-20 | River: all-day becomes 22:00, duplicate promises, hidden items, no delete | Medium | PEB-85 | Open |
| B-22 | Small UI defects (link preview per keystroke, Hub hides errors, timeline, sidebar…) | Low | PEB-86 | Open |

## Performance

All five are tracked in **PEB-28** (comment) and PEB-93.

| ID | Problem |
|---|---|
| P-01 | Hub retrieval loads every note's full text on every question |
| P-02 | Notes list without `limit` returns everything; `LIKE` search with no FULLTEXT index |
| P-03 | Dashboard counts in JavaScript; voice prompts include every task and note |
| P-04 | Extra auth DB query per request (doubled on duplicate routes); AI clients rebuilt per call; long provider timeouts |
| P-05 | Import is one-by-one with no transaction; key scan of all users on every start; tag race |

## Debt and docs

| ID | Problem | Jira | Status |
|---|---|---|---|
| D-01 | Dead components, CSS, packages and mobile paths | PEB-88 | Open |
| D-02 | README and docs describe the old SQLite app; `.env.example` incomplete | PEB-87 | Open |
| D-03 | No type-check; CI runs no tests; tests write to whatever DB `.env` names | PEB-31 (comment) | Open |
| D-04 | Deprecated Gemini SDK, hard-coded models, unused key slots and embeddings | PEB-89 | Open |
| D-05 | Five styles differ in core features; duplicated logic; style not saved to the account | PEB-90 | Open |

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
| G-08 | `[[links]]` and backlinks | PEB-98 |
| — | Password reset, email verification, account deletion, chat history on the server, deployment, backups, CI, unit tests, accessibility, responsive | PEB-22…34 (created earlier) |

The longer list of about 60 planned items (by PRD requirement ID) is in `05-platform.md` §6.2.

## Suggested order

1. **This week (owner):** revoke the leaked secrets (PEB-55), then purge them and the PDF from history (PEB-67).
2. **Before anyone outside uses the app:** PEB-56, PEB-57, PEB-58, PEB-59, PEB-60, PEB-61, PEB-62, PEB-24, PEB-26, PEB-74, PEB-29.
3. **Quick wins for new developers:** PEB-68, PEB-69, PEB-70, PEB-78, PEB-86, PEB-88.
4. **Then:** quality (PEB-31, PEB-72, PEB-75, PEB-77), then features (PEB-91, PEB-92, PEB-93, PEB-94).
