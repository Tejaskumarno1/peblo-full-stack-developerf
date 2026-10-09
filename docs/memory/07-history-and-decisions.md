# 07 · History and decisions

## How Peblo got here (from git history, branch `app`)

| When | What changed | Key commits |
|---|---|---|
| 25–26 May 2026 | Built for the "Collaborative AI Notes Workspace" challenge: React web app plus an Express API on **Postgres (Supabase)**, Gemini AI, deployed on Vercel. Had public share links, a dashboard, an AI chat panel and PDF export. A `.env` with real secrets was committed here. | `8ac6634`, `9ec68f9`, `2a368e7`, `8405684` |
| 1–9 Jun 2026 | Mobile view, Notion-like block editor, Google sign-in attempt, Vercel fixes, query and index optimisation | `82707b3`, `922026b`, `07cdca3`, `d2d637e` |
| 24 Jun 2026 | Service-worker cache bump, Prisma generation for Vercel | `40e2539` |
| 25 Sep 2026 | **Became an offline desktop app:** Electron + SQLite, single user, no accounts. Sharing was removed. | `50861e5` |
| 26 Sep 2026 | Local AI (Ollama), quick capture, Notion import, Markdown export. Product docs 00–06 written for this SQLite build. | `fa7faf1`, `b8d411a` |
| 27–28 Sep 2026 | Redesign from mockups; Style setting (Studio, Console, Soft Studio) | `da4b699`, `ed06df2`, `daa66da` |
| 5–6 Oct 2026 | Fixed 1440×900 design canvas at any size/zoom/DPI; River and Orbit styles | `1547556`, `84c7183` |
| 6–7 Oct 2026 | **Back to multi-user:** Postgres, then **MySQL**; sign-in screen, JWT, authenticated sockets; seed script | `ef82253`, `66cf624`, `3a0f1a3`, `72d5016` |
| 7–8 Oct 2026 | Account security (bcrypt 12, token version, rate limits), encrypted AI keys, hosted mode, notes list paging; product, technical, design and go-to-market docs; OpenAI key bug fix | `3157c76`, `01d544b`, `8b0a99b` |
| 8 Oct 2026 | Reverse-engineering pass: this memory folder, plus Jira PEB-35…98 | `2c611d0` |
| 9 Oct 2026 | Verification and coverage pass, Jira PEB-99…120 | (this commit) |

**Why this matters:** many files still describe an older stage. README and `docs/00–06` describe the SQLite single-user build. `done.txt`, `implementation_plan.md` and the `.kiro` spec describe the May web app. The code is the truth, and this memory describes the code.

## Decisions already made

| Decision | Where it shows |
|---|---|
| MySQL 8 + Prisma 6, with hand-written SQL migrations applied at start-up (not `prisma migrate`) | `server/src/db.ts`, `server/prisma/sql/` |
| Accounts with email + password; JWT for 30 days with a token version for "sign out everywhere" | `middleware/auth.ts` |
| Users' AI keys encrypted with AES-256-GCM in their own table | `secrets.ts`, `user_api_keys` |
| One server, two ways to run it: in-process in Electron, or hosted (`npm run serve`) | `electron/main.cjs`, `docs/DEPLOYMENT.md` |
| AI provider order: OpenAI → Gemini → Ollama, controlled by user routing (Local only / Ask first / Auto) | `aiService.ts` |
| Notes stored as Markdown, edited in BlockNote | `BlockEditor.jsx` |
| Every screen designed at 1440×900 and scaled; no responsive layout in the desktop app | `design/canvas.js`, `main.cjs` `applyScale` |
| Five UI styles kept side by side; the style is saved per device | `App.jsx`, `AppShell.jsx` |
| Jira project PEB, Kanban board with 12 statuses; features = PEB-1…9 | Jira |

## Open decisions (owner)

1. **Product name.** "Peblo" may clash with the company that set the challenge (`docs/README.md`).
2. **Licence.** None yet (PEB-67).
3. **Desktop architecture.** Make hosted mode the default for installers and stop shipping database credentials (PEB-56)? This also decides where migrations run.
4. **Hosting provider and budget** (PEB-29), and whether shared server AI keys stay on (PEB-26).
5. **Code-signing budget**: Apple Developer $99/yr, Windows certificate (PEB-96).
6. **Which styles to keep.** Five styles multiply every fix by five; decide a core feature set (PEB-90).
7. **Direction from `docs/00-vision-and-strategy.md`**: Path B ("memory for your AI tools", MCP, PEB-95) or a student focus (Orbit).

## Change log for this memory

| Date | Change |
|---|---|
| 8 Oct 2026 | Created from a full read of the code (server, client, five styles, Electron, scripts, docs) at commit `8b0a99b`. |
| 9 Oct 2026 | Verification pass: static checks, the real server against a recording fake database, pure-logic tests, and the production UI in a browser (08, 09). Coverage review of everything the first pass skipped (10). Jira PEB-99…120 added; PEB-55 widened to 4 keys; PEB-68 lowered to Medium; corrections listed in 08. |
