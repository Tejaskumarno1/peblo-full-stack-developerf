# 08 · Verification: what was proved by running the code

Date: 9 Oct 2026, commit `2c611d0` (branch `app`). Files 02–05 were written by **reading** the code. This file records what was then **run**, how it was run, and the verdict for each issue. Details are in [09-ui-runtime.md](09-ui-runtime.md) (browser tests) and [10-coverage-review.md](10-coverage-review.md) (what the first pass missed).

## How it was tested

| Layer | Method | Limits |
|---|---|---|
| Static | On the owner's PC: `tsc --noEmit -p server/tsconfig.json`, `prisma validate`, `vite build`, `npm audit` (root and client) | — |
| Server logic | The **real compiled server** (`dist/server`) started on the PC with a **fake Prisma client** that records every query and returns test data. HTTP probes plus a socket.io client. No database was touched. | Prisma's own behaviour (for example, ignoring `undefined` filters) is inferred from the query sent, not executed. SQL and migrations were not run. |
| Pure logic | Real `parseTask.js`, `helpers.js`, `orbitUtils.js`, `riverUtils.js` and `activityStats.js`, with a fixed clock (Mon 5 Oct 2026 10:00 IST, TZ Asia/Kolkata) | — |
| UI | The **production client build** in Chromium (Playwright, 1440×900) against a mock API with seed-like data: 5 styles × 8 screens, scripted bug reproductions, an accessibility sweep | No real server behind it; socket.io absent; Electron-only features (tray, global shortcut, zoom lock) not tested |
| Real MySQL | **Done 9 Oct (later):** empty `peblo_test` database, migrations applied from scratch, `npm test` = all ~70 checks passed (auth, notes, search, todos, import/export, AI routing, sign-out-everywhere). The tests do not cover the bugs listed below, so they pass alongside them. Earlier note:  Running SQL against the owner's local MySQL was blocked by a safety check. To run `npm test` safely, the owner can create an empty `peblo_test` database and point `DATABASE_URL` at it for the test run. | Migrations (B-05), real search and the full smoke test remain unverified |

The harness lives on the PC in `.verify/` (untracked).

## Static results

- **TypeScript:** the server passes `tsc --noEmit` in strict mode with **0 errors**, so the "no type-check" risk (D-03) is about the future, not current breakage.
- **Prisma:** `prisma validate` passes.
- **Client build:** `vite build` passes in about 20 s. Largest chunks: editor 1,203 kB (366 kB gzip), pdf 984 kB, native 433 kB; CSS 317 kB + 222 kB (→ P-06, PEB-103).
- **`npm audit`, root:** 14 issues (2 critical: `concurrently` and `shell-quote`; 4 high, including `prisma`).
- **`npm audit`, client:** 29 issues (13 high, including `axios`, `react-router`, `socket.io-parser`, `vite` and `ws`) (→ S-16, PEB-99).

## Verdict per issue

✅ confirmed by running · ⚠️ partly confirmed / corrected · ❌ not reproduced · ⏸ not testable here

| ID | Jira | Verdict | Evidence (short) |
|---|---|---|---|
| S-02 | PEB-55 | ✅ **worse** | 4 distinct Gemini keys in 4 files across commits `8ac6634`, `94b8e07`, `4e1c01c`, `9ec68f9` (+ the DB password) |
| S-03 | PEB-24 | ⚠️ | Link preview returned an internal page's title and description ✅. The Ollama check gives the same message for open and closed ports, so it is **not** a port scanner by message ❌ |
| S-04 | PEB-58 | ✅ | A key encrypted with secret A decrypts to `null` with secret B |
| S-05 | PEB-59 | ✅ | `GET /api/profile` returns the plaintext key; `peblo-settings` holds it after sign-in |
| S-06 | PEB-60 | ✅ | `peblo_cached_notes` (15.7 KB) survives sign-out. After a forced 401, settings with the key and Hub chats survive. The next account sees A's key, notes and chat |
| S-07 | PEB-61 | ✅ | Script ran via AI panel chat, an AI Hub `javascript:` link, and PDF export; `noteTitle` is also raw in the PDF template |
| S-08 | PEB-62 | ✅ | 80 MB upload accepted (+333 MB RAM); `.exe` as text accepted; 299 KB zip → 300 MB note (+894 MB RAM) |
| S-10 | PEB-63 | ✅ | Login takes 275 ms for a known email vs 5 ms for an unknown one; signup 409; all requests share one IP limit |
| S-13 | PEB-66 | ✅ | Raw 500 message, CORS → 500, 2 MB bio and wrong types saved, bcrypt 72-byte cut, HTML 404, socket alive after token revoked |
| B-01 | PEB-68 | ✅ (priority lowered) | 500 "reading 'map'" on bad note/todo input; `?tag=a&tag=b` → 500; `isArchived` ignored. The UI never sends such input |
| B-02 | PEB-69 | ✅ | `updateMany({where:{id:undefined,userId}})` sent; 200 success |
| B-06 | PEB-73 | ✅ | 09:00 and 23:00 IST edits both land on the previous day; zero notes still gives streak 1 / edits 1; overdue `take: 10` |
| B-07 | PEB-74 | ✅ | With a UTC server, "today" = 05:30–05:29 IST |
| B-08 | PEB-75 | ✅ | Mock summary saved as a real one; placeholder block text; junk notes created by chat and intake; `{title}` key |
| B-09 | PEB-76 | ✅ | Monthly from 31 Jan → 31 Jan, 3 Mar, 3 Apr…; daily = 30 rows |
| B-10 | PEB-77 | ✅ | No socket event for note PATCH/DELETE/archive/restore or toggle-task |
| B-11 | PEB-70 | ✅ **worse** | Restored/unarchived notes never return to All; deleted/archived notes can't be opened from Trash/Archive |
| B-12 | PEB-78 | ✅ | Ctrl+K on Notes doesn't open the palette in Studio/Console; Ctrl+Shift+S saves |
| B-14 | PEB-79 | ✅ | Day view Next → empty; drag sends only `deadline` and keeps the old `startTime` |
| B-15 | PEB-80 | ✅ | "next friday 3pm" → this Friday 17:00 with "3pm" left in the text; "monday.com" eaten; 23:30 meeting has zero length; relative dates wrong |
| B-17 | PEB-82 | ⚠️ | Font size has no effect ✅; routing shows blank ✅; "Settings overwrites routing" ❌ |
| B-19 | PEB-84 | ✅ | Enter ×3 → 3 answer POSTs; "was X%" shows the new score; revision path empty with unquizzed topics |
| B-20 | PEB-85 | ✅ | Move pre-fills 22:00 and saves it; no delete in River |
| B-22 | PEB-86 | ✅ | 10 link-preview requests for one typed URL; new: breadcrumb title squeezed to 2 px |
| D-05 | PEB-90 | ✅ | Parity gaps confirmed: River delete, River/Orbit history, Soft search |
| B-03, B-04, B-05, B-16 | PEB-57, 71, 72, 81 | ⏸ | Need a packaged install, an Intel Mac, real MySQL, or the voice call (deliberately silenced) |
| S-01, S-09, S-11, S-12 | PEB-56, 26, 64, 65 | ⏸ | Architecture and config findings; true by reading, nothing to "run" |

## New findings from verification

| ID | Finding | Jira |
|---|---|---|
| S-16 | Known-vulnerable dependencies (see Static results) | PEB-99 |
| D-06 | GitHub default branch `main` is the old web app, 17 commits behind `app`; stale `desktop-app` branch | PEB-100 |
| D-07 | CSS debt: 598 hard-coded colours, 186 `!important`, z-index 3000 clash, undefined `--bg-card`, lazy CSS changing global classes | PEB-101 |
| B-23 | Probable light flash on start for dark themes (inferred, not reproduced) | PEB-102 |
| P-06 | Bundle and installer size (fonts, editor, unbundled server) | PEB-103 |
| B-24 | Focus ring faint, missing on the active nav link and in high-contrast mode | PEB-120 |
| — | Missing tickets for planned features: D5, D8, HUB-12, CON-01..06, PLAT-04, PLAT-10, CAP-03, KN-06, ACT-06, HUB-08/09/10/13, PLAT-05, DATA-06/07, PLAT-07 | PEB-104…119 |

## Corrections to the earlier memory

- The Ollama check is not a port scanner by its message (S-03 corrected).
- KN-02 backlinks are **Partial**, not Missing: `NoteContextPanel.jsx` ~35–42 matches note titles in other notes' text (G-08 / PEB-98).
- The HUB-01 shortcut exists: Ctrl/Cmd+J in `AppShell.jsx` ~33–44.
- The `pc` remote is gone; only a stale ref remains (05-platform fixed).
- The secret leak covers 4 files and 4 keys, not 1 (S-02 / PEB-55 updated).
- The PDF export injection also uses `noteTitle` raw (`WorkspacePage.jsx` ~373).
