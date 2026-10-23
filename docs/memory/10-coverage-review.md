# Peblo memory: what the first pass missed (coverage review)

Repo: the repo, branch `app` @ `2c611d0` (9 Oct 2026). I did not modify the repo. Paths are repo-relative. Line numbers are exact unless they start with `~`.

---

## 1. Coverage matrix

`git ls-files` gives **195 tracked files**. I checked each one against `docs/memory/*.md` and `CLAUDE.md`:

| Match | Files |
|---|---|
| Full path mentioned | 55 |
| Only the basename mentioned | 125 (spot-checked: nearly all of them really are described, e.g. every `styles/*.css` in 03-client §5 at line 326) |
| **Not mentioned at all** | **15** (below) |

Basenames shared by several files (`index.js` ×3, `index.ts` ×2, `auth.ts`, `profile.ts`): every copy is mentioned by path except **`client/src/components/workspace/index.js`** and **`server/src/schemas/index.ts`**. Those two are mentioned only by directory ("Zod schemas in `server/src/schemas`").

### Unmentioned files, read and described

| File | What it does | Findings |
|---|---|---|
| `client/src/store/workspaceStore.js` (44 lines) | Zustand store for the Notes page: search/filter/sort, archive/trash toggles, sidebar, AI panel, focus mode, task list, backups, mobile menu, share modal | **Dead state:** `isShareModalOpen`/`setIsShareModalOpen` (:42-43) belong to the share feature, which was removed. `isMobileMenuOpen` is mobile-only and the app is desktop-only. The memory documents `useUIStore.js` but never mentions this second store. |
| `client/src/components/workspace/index.js` | Barrel that re-exports NotesSidebar, EditorToolbar, AiWorkspacePanel, BackupsPanel, MobileEditorControls, WelcomeScreen | Fine. `NoteContextPanel` is not in the barrel; `WorkspacePage.jsx:15` imports it directly. |
| `client/src/components/workspace/EditorToolbar.jsx` (126) | Desktop top bar of a note: breadcrumb `Notes / #tag / title`, save status, Tasks toggle, focus mode, Preview, a "More" menu (Version history, export MD/PDF/Word/HTML/TXT), and "Ask AI (Ctrl+J)" | `desktop-only` class (:54). The save text "Saved to your account" (:51) is shown even in desktop mode. Both buttons that open menus lack `aria-haspopup`. |
| `client/src/components/workspace/MobileEditorControls.jsx` (128) | Mobile header and bottom action bar (Save, More → Backups, exports) | **Dead in practice**, because everything is `mobile-only` and the app is a fixed 1440×900 canvas. `setIsShareModalOpen` is destructured but never used (:36). `Link2` is imported but never used (:13). The divider uses inline styles (:104). Add it to the PEB-88 dead-code list. |
| `client/src/components/workspace/NoteContextPanel.jsx` (135) | Right column beside an open note: "Ask about this note" (goes to `/ai?q=&note=&noteTitle=`), chips (Summarise / Get tasks / Flashcards), **linked tasks** (`todosAPI.getAll({noteId})`, server filter at `todosController.ts:8`), quick add through `parseTask`, **Backlinks**, created date and History | (a) **There is a backlinks feature** (:35-42): a case-insensitive substring match of the note title (≥4 chars) against other notes' content, capped at 6. The memory gap list (05-platform §6.2, "KN-02 … Missing") and 06-issues G-08 say backlinks do not exist; they are actually **Partial**. Substring matching means a title like "Java" also matches "JavaScript". (b) `toggle` (:51-58) updates optimistically but never rolls back on error. (c) `addTask` (:60-67) has no `try/catch`, so a failed POST is an unhandled rejection and the input is already cleared. (d) `dueLabel` uses the local `setHours` (correct), but the deadline is created with `p.deadline.toISOString()`, the same UTC issue as PEB-74. (e) It passes the note title in the `/ai?noteTitle=` URL (fine locally). |
| `client/src/components/workspace/WelcomeScreen.jsx` (80) | Empty state of the Notes page: "New note", "Open latest", shortcut hints, recent-note cards | The cards are `<div onClick>` with no role or tabIndex, so they are **not keyboard-reachable** (:58-62). It advertises "Ctrl+K search", which is broken on this page (memory 03-client #8). |
| `client/src/soft/SoftAI.jsx` (217) | Soft Studio AI Hub (chat list, thread, model picker, attach, follow-ups) on `useHubChat` | Renders `renderAnswer()` through `dangerouslySetInnerHTML` (:88). It is escaped first, but `[x](javascript:…)` links survive (already S-07). It says "Chats stay on this computer" (:58), which is true even in hosted mode (localStorage), but it conflicts with PEB-27. The memory mentions `SoftAI` only as a mockup name. |
| `server/src/types/express.d.ts` | Adds `req.user?: {id, email?}` to Express `Request` | It is optional, so controllers use `req.user!` everywhere, and `notesController` uses `req: any` (`createNote(req: any…)`, :189). |
| `server/src/types/pdf-parse.d.ts` | Declares a module shim for `pdf-parse/lib/pdf-parse.js` | Deep-importing the lib avoids pdf-parse's debug-mode self-test (`index.js` reads `./test/data/…pdf`). This is deliberate, but nothing documents it. pdf-parse 1.1.x bundles a very old pdf.js (v1.10/2.0 era). Text extraction is the only path used, but it is unmaintained code that parses untrusted PDFs (smart-intake upload). |
| `docs/design/*.svg` (5 wireframes, 18–29 KB, no scripts or external refs) | Wireframes for navigation, AI Hub, tool approval, connections and onboarding | The memory mentions them only as a glob (05-platform:274). `onboarding.svg` still says "**No account, no email**", which contradicts the account-based app (sign-in screen, PEB-10). |
| `package-lock.json`, `client/package-lock.json` | Lockfiles | See §4. |

### Other tracked files the memory mentions but never actually analyses
- `.github/workflows/build-desktop.yml`: described in 05-platform §2.3. **Missed:** it uses `npm install`, not `npm ci` (:26-27), so CI can re-resolve caret ranges and build from a lock that differs from the committed one. Actions are pinned to tags (`@v4`, `softprops/action-gh-release@v2`), not SHAs. The `build` job declares no `permissions:` block, so it gets the default `GITHUB_TOKEN` scope, and `GH_TOKEN` is passed to every OS build (:34). There is no dependency cache.
- `client/src/styles/*`: the memory describes each file in one line. Nothing analyses CSS, so see §2.
- `build/icon.png`: correctly described (281,370 B). It is also the **largest blob in history** (§3).

---

## 2. CSS, themes and design tokens

Scope: 23 files in `client/src/styles/` plus `orbit/orbit.css`, `river/river.css`, `soft/soft.css`, **13,858 lines** in total.

### 2.1 How theming works
- **Theme** (`light` | `dark` | `midnight` | `system`): `AuthContext.jsx:44-59` toggles the **classes** `theme-dark` (dark or midnight) and `theme-midnight` on **both `<html>` and `<body>`**. `system` uses `matchMedia('(prefers-color-scheme: dark)')` and listens for changes. **No CSS file uses `data-theme` or `prefers-color-scheme`**; everything goes through the classes.
- **Style** (`studio` | `console` | `soft` | `river` | `orbit`): `AuthContext.jsx:63` sets the **attribute** `data-style` on `<html>` and `<body>`.
- Cascade in `tokens.css`:
  - `:root` (Paper) → `.theme-dark` (Graphite, :57) → `.theme-dark.theme-midnight` (:92).
  - Then per style: `[data-style=X]` (0,1,0) → `[data-style=X].theme-dark` (0,2,0) → `[data-style=X].theme-dark.theme-midnight` (0,3,0), for console :193/230/257, soft :267/308/340, river :350/381/403, orbit :413/445/467.
  - `[data-style=X]` and `.theme-dark` have **equal specificity**, so source order decides. I checked whether any style's light-only token could beat the generic dark value: none can (every style redefines its tokens in its own dark block).
- River, Orbit and Soft also keep **private palettes** scoped to `.river`, `.orbit` and `.soft` (`--r-*`, `--o-*`, `--s-*`), with `.theme-dark .orbit` and `.theme-midnight .orbit` overrides (e.g. `orbit.css:7,37,65`).
- **Legacy bridge:** `tokens.css:116-163` maps the old `--bg-*`, `--text-*`, `--accent*` and `--border*` variables onto `--pb-*`. `index.css` still defines its own full `:root` (71 vars) and `.theme-dark` (48 vars) blocks of these legacy variables. Because `index.css` is imported *before* `tokens.css` (`main.jsx:46-48`), the tokens win. Its type scale (`--text-xs`…`--text-2xl`), `--line-height-*` and `--tag-*-text/bg/border` variables are defined **only** in `index.css`.
- **Midnight coverage gap:** only `tokens.css` and the three style files know about `theme-midnight`. `workspace.css` (34 `.theme-dark` rules), `dashboard.css` (22), `ai-chat.css` (17), `calendar.css` (8) and `index.css` (6) hard-code Graphite-era colours under `.theme-dark` (e.g. `dashboard.css:1112-1118`, `--dash-bg:#0a0a0f`). Any screen that still uses them shows near-black instead of pure black in Midnight. `calendar-pb.css:6-8` remaps `--dash-*` onto tokens, which partly fixes this for the Calendar.
- **Start-up flash (not in memory):**
  - Nothing sets the theme before React runs: `client/index.html` has no inline theme script.
  - The main window's `backgroundColor` is the light `#F6F5F2` (`electron/main.cjs:194`), and the quick-capture window is `#ffffff` (:260).
  - Dark and midnight users therefore likely see a light frame on every launch and every capture popup. I inferred this from the code and did not reproduce it.

### 2.2 Token inventory (`tokens.css`)
- **Colour** (`:root`, 45 vars; dark 31; midnight 19):
  - Surfaces: `--pb-bg`, `--pb-surface`, `--pb-surface-2`, `--pb-surface-3`.
  - Lines: `--pb-line`, `--pb-line-2`.
  - Text: `--pb-fg`, `--pb-fg-2`, `--pb-fg-3`.
  - Accent: `--pb-accent`, `--pb-solid`, `--pb-on-solid`, `--pb-soft`, `--pb-soft-line`.
  - Status pairs: `--pb-local`/`-soft`, `--pb-cloud`/`-soft`, `--pb-warn`/`-soft`, `--pb-danger`/`-soft`.
  - Other: `--pb-kbd`, heat colours `--pb-heat-0..4`, `--pb-tile-1..5`.
- **Effects:** `--pb-shadow`, `--pb-shadow-lg`, `--pb-focus` (a 3px ring at 28% alpha).
- **Type:** `--pb-font` (Geist), `--pb-font-display` (Instrument Serif), `--pb-font-mono` (Geist Mono), `--pb-display-weight`, `--pb-display-tracking`. Each style swaps these (Space Grotesk / IBM Plex Mono for console, Figtree / Bricolage for soft, Sora / Hanken for river, Familjen / Fragment Mono for orbit). There is **no size scale in `tokens.css`**; the scale lives only in legacy `index.css`.
- **Radius:** `--pb-r-card 16`, `--pb-r-box 12`, `--pb-r-ctl 9`, `--pb-r-pill 99` (px). The legacy `--radius-sm/md/lg` are still used 23+ times.
- **Spacing: none.** There is no spacing token at all; every padding and gap is a literal. The legacy `--space-*` set is not defined either.
- **Defined-but-unused custom properties:** 35 of 238.
- **Used-but-undefined:** `--bg-card` (`workspace.css:1975`, live file, no fallback, so the background is dropped). `--dash-primary-hover`, `--radius-full` and `--text-3xl` are used only in the dead files `todolist.css` and `shared.css`.

### 2.3 Per-file counts
"lit" counts colour literals in normal declarations, i.e. colours that bypass tokens. Hex values inside `--var:` definitions are excluded.

| File | Lines | hex (all) | rgb/hsl (all) | **lit** | !important | z-index | outline:none | :focus-visible | tiny font (<11px / <0.69rem) | Loaded? |
|---|---|---|---|---|---|---|---|---|---|---|
| workspace.css | 2859 | 44 | 147 | **191** | **95** | 13 | 6 | 0 | 16 | Notes page |
| index.css | 1585 | 58 | 100 | 60 | 1 | 10 | 3 | 0 | 4 | global |
| dashboard.css | 1322 | 40 | 71 | 83 | 11 | 6 | 0 | 0 | 5 | Calendar, TodoListPanel |
| calendar.css | 1139 | 41 | 33 | 74 | 6 | 6 | 4 | 0 | 10 | Calendar |
| ai-chat.css | 1100 | 37 | 65 | 87 | 6 | 4 | 1 | 0 | 7 | only by dead `AiChatPanel` |
| soft.css | 828 | 49 | 21 | 1 | 23 | 6 | 9 | 9 | 0 | eager (SoftShell) |
| todolist.css | 766 | 17 | 15 | 32 | 6 | 1 | 7 | 0 | 0 | **never imported** |
| river.css | 619 | 41 | 8 | 1 | 10 | 13 | 1 | 2 | 0 | eager |
| orbit.css | 519 | 61 | 8 | 11 | 10 | 13 | 2 | 3 | 10 | eager |
| shell.css | 501 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | eager |
| tokens.css | 474 | 266 | 32 | 0 | 2 | 0 | 1 | 1 | 0 | global |
| share-modal.css | 240 | 0 | 2 | 2 | 0 | 1 | 1 | 0 | 0 | **never imported** |
| shell-styles.css | 239 | 41 | 2 | 43 | 0 | 0 | 1 | 2 | 0 | eager |
| notes.css | 219 | 0 | 1 | 1 | 2 | 0 | 5 | 10 | 0 | Notes |
| others (12 files) | 1448 | 1 | 11 | 12 | 13 | 6 | 10 | 4 | 1 | – |
| **Total** | **13,858** | **696** | **516** | **598** | **186** | **79** | **52** | **31** | **53** | |

- **z-index values in use:** 1, 2, 3, 5, 6, 10, 15, 20, 30, 31, 40, 50, 60, 70, 80, 100, 120, 180, 200, 1000, 1100, 1200, 2000, 3000, 10050, 10060 and -1. Inline JSX adds 10, 50, 100 and **9999**. There is no scale.
  - The **command palette** (`command-palette.css:17`), **Settings overlay** (`index.css:1356`) and **voice-call modal** (`ai-call.css:7`) all use **3000**, so whichever is later in the DOM wins. A voice call that rings while Settings is open can render underneath it.
  - The dead chat panel uses 10050/10060 (`ai-chat.css:24,158`).
- **Duplicate and conflicting rules:**
  - 179 class names are defined in more than one file. The biggest overlaps are notes.css ↔ workspace.css (23 classes; notes.css overrides by design), calendar-pb.css ↔ calendar.css (22) and dashboard.css ↔ index.css (9).
  - Repeated selectors within one file: index.css 37 (e.g. `.btn-icon-sm` at :310 and :777, plus the whole `.floating-navbar*` and `.navbar-*` set of the old web navbar), workspace.css 79 (`.ws-sidebar` ×5, `.workspace-page` ×3), dashboard.css 14 and calendar.css 14.
  - **Order-dependent cascade:** pages are lazy (`App.jsx:8-39`), so `workspace.css`'s copies of `.btn-icon`, `.btn-icon-sm`, `.tag-chip`, `.tag-default` and `.spinner` (`dashboard.css`) only apply **after the user first visits Notes or Calendar**, and then they stay applied app-wide. The same button can look different before and after visiting Notes.
  - Soft, River and Orbit are properly scoped (`.soft …`, `.r-*`, `.o-*`), so their shared names (`.chip`, `.badge`, `.empty`) do not collide.
- **Selectors that look unused** (grep of each class name against all JS/JSX): **312 of 1,531** classes.
  - By file: index.css 73, dashboard.css 57, workspace.css 47, orbit.css 46, river.css 42, todolist.css 28, share-modal.css 20, shared.css 11, soft.css 9.
  - Spot-checked unused: `.floating-navbar-wrapper`, `.navbar-logo-text`, `.stats-grid` and `.dash-mockup-grid` have 0 JSX hits. The `.navbar-*`, `.notification*`, `.skeleton-*`, `.glow-*`, `.dash-greeting-*` and `.shortcuts-modal*` families all belong to the removed web UI.
  - False positives: the `.bn-*` names are BlockNote's internal classes, and a few classes are built from template strings.
  - Full list: `scratchpad/unused.txt`.

### 2.4 Fonts (`client/src/main.jsx:8-45`)
- **34 `@fontsource` weight files in 11 families**, all imported eagerly whatever the style:
  - Geist 400/500/600/700; Geist Mono 400/500; Instrument Serif 400 and 400-italic.
  - Space Grotesk 400/500/600/700; IBM Plex Mono 400/500/600.
  - Figtree 400/500/600/700; Bricolage Grotesque 500/700/800.
  - Sora 400/600/700; Hanken Grotesk 400/500/600/700.
  - Familjen Grotesk 400/500/600/700; Fragment Mono 400.
- **Build weight (estimate only; `node_modules` is not installed and the registry is blocked):**
  - Each fontsource 5.x weight CSS declares one `@font-face` per unicode subset (2–5 subsets, e.g. latin, latin-ext, cyrillic, vietnamese), each with woff2 and woff. That is roughly 34 × ~3.5 × 2 ≈ **240 font files, about 4–7 MB in `client/dist/assets`**, plus about 120 `@font-face` rules in the entry CSS.
  - At runtime `unicode-range` and lazy font loading mean only the latin woff2 files of the active style get downloaded, so the cost is mostly installer and asar size, not page load.
- All 11 families are **OFL-1.1**. OFL requires the licence to ship with the fonts; electron-builder does not add it.

### 2.5 Accessibility
- **`prefers-reduced-motion`:** exactly one rule, global (`tokens.css:179-184`). It sets animation and transition duration to 0.01ms with `!important`. It does not cover JS-driven motion: `framer-motion` in `TodoItem`/`TodoEditModal` and `scrollIntoView({behavior:'smooth'})` (e.g. `SoftAI.jsx:28`).
- **Focus:**
  - Global `:focus-visible { outline:none; box-shadow: var(--pb-focus); border-radius: 8px }` (`tokens.css:173-177`).
  - Soft, Orbit and River each have their own scoped version (`soft.css:110`, `orbit.css:93`, `river.css:86`).
  - Problems:
    1. The ring is `rgba(79,70,229,.28)`: a translucent lavender at about 1.6:1 against white, below the 3:1 non-text contrast that WCAG 1.4.11 requires.
    2. Setting `border-radius: 8px` on *every* focused element changes its shape, which affects round buttons and checkboxes.
    3. Because the ring is a box-shadow, it disappears in Windows High-Contrast / forced-colours mode, where box-shadows are removed and the outline is already `none`.
    4. Any component `box-shadow` with higher specificity replaces it.
- **`outline:none` with no replacement:** 40 rules remove the outline without setting `box-shadow` or `border-color` (full list in my notes; examples below). Most rely on the global ring, but **13 explicitly kill it with `:focus-visible { box-shadow:none }`** and have no `:focus-within` replacement on the wrapper:
  - `soft.css:291` (.s-ask-row input), :335 (.s-capture-input), :490 (.s-note-title), :616 (.s-addbar input), :774 (.s-composer-row input). **soft.css has no `:focus-within` rule at all.**
  - `orbit.css:123` (.o-ask input), :306 (.o-title-input).
  - `river.css:408` (.r-title-input).
  - `notes.css:161` (.nc-ask-row input). `notes.css:183/210` (.nc-add) has only a faint inset line.
  - `shell-styles.css:91` (.cs-cmd input, border-colour change only).
  - On those inputs the caret is the only focus cue.
- **Tiny type:** 53 rules below 11px / 0.69rem. Examples: `index.css:1071` **8px**, `workspace.css:443,472,2347` 9px, `calendar.css:881` 0.55rem (8.8px), `workspace.css:2734` 0.58rem. JSX adds 68 more tiny inline `fontSize` values.
  - The canvas is **scaled down** to fit small windows (`canvas.css`; minimum window 720×450, `main.cjs:191`), so at a 0.8 scale a 10px label renders at 8px.
- **Contrast** (WCAG 2.1, computed from the resolved tokens for every style × theme):
  - All primary text pairs pass easily: fg/bg is 15–19:1, fg-2/surface 6.9–11.5:1, fg-3/surface 4.7–7.2:1.
  - Failures:
    - `--pb-line-2` on `--pb-surface` is **1.3–1.8:1 in every combination**. That is fine for decorative borders, but `--pb-line-2` is the token used for input and control borders (`--border-default`/`--border-strong`, `tokens.css:146-147`), which need 3:1 (WCAG 1.4.11).
    - **Orbit dark/midnight:** `--pb-on-solid` on `--pb-solid` is **3.64:1** (fails 4.5:1 for button text).
    - Studio and Soft light: `--pb-local` on `--pb-local-soft` is **4.38:1 and 4.20:1** ("On this computer" badges, fails 4.5).
    - River light: `--pb-accent` on `--pb-soft` is **4.49:1**.
    - Orbit's private `--o-fg3` is 1.9–2.5:1, but it is used only for decorative dots (`orbit.css:241`), so that is acceptable.
- **Keyboard:** `WelcomeScreen` cards (see §1) and other `div onClick` cards are not focusable.
- Design doc 05-design §2.2 A17 ("zero `:focus-visible` rules, no reduced-motion") is now **outdated**: there are 31 focus-visible rules and one reduced-motion rule. A6 (234 inline styles, 52 in SettingsModal) has **grown to 402 and 62**. A19 (start-up flash) still applies to dark themes.

---

## 3. Git

### 3.1 Branches and remotes
- Local branches: `app` (checked out), `main`, `desktop-app`.
- Remote-tracking refs: `origin/app`, `origin/main`, `origin/HEAD → origin/main`, and **`pc/desktop-app`**.
- **Only `origin` is configured** (`git config --get-regexp remote`). The `pc` remote no longer exists; `refs/remotes/pc/desktop-app` is a stale ref. Memory 05-platform:3 says "remotes `origin`, `pc`", which is inaccurate.
- **The GitHub default branch is `main`** (`origin/HEAD`). `main` holds the *old web app*, so anyone who clones the repo gets the obsolete Vercel/Postgres app, not the desktop app. The memory never says this.

| Branch | Commits | vs `app` | Notes |
|---|---|---|---|
| `app` = `origin/app` | 80 | – | current product |
| `main` = `origin/main` (`40e2539`, 24 Jun 2026) | 63 | 0 ahead / **17 behind** (fully contained in app) | original React + Express + Postgres web app (Vercel, share links, service worker). `git diff main app`: 202 files, +31,479/−13,505 |
| `desktop-app` = `pc/desktop-app` (`0af05bc`, 26 Sep) | – | **4 ahead** / 16 behind, base `50861e5` | 4 commits "wip feat1..4" by author **`x <x>`**: quick capture, Notion import, `transfer.ts`, `importService.ts`, AI-service changes, smoke test (15 files, +1,199/−234). `git cherry` shows them as not in app by patch-id, but the same features landed in app as `fa7faf1` and `b8d411a` (two commits with **identical messages**, "Add local AI, quick capture, Notion import and Markdown export"). The branch is stale and safe to delete once that is confirmed. It was never pushed to origin. |

### 3.2 Authors and timeline
- By author:
  - Boddu Tejas Kumar <142080108+Tejaskumarno1@users.noreply.github.com>: **77**
  - Boddu Tejas Kumar <boddutejaskumar@gmail.com>: 3
  - `x <x>`: **4** (anonymous identity, the wip commits)
  - Claude <noreply@anthropic.com>: 2
  - Committers also include `GitHub` (1, a web-UI commit).
- By month: 2026-05 **40**, 2026-06 **23**, Jul–Aug **0** (a two-month gap), 2026-09 10, 2026-10 13.

### 3.3 Churn (all branches)
- **Most-changed files by number of commits:**
  - WorkspacePage.jsx 33, workspace.css 25, vercel.json 14 (deleted now), schema.prisma 14, AiChatPanel.jsx 14, server/src/index.ts 13, package.json 13.
  - server/package.json 12 (deleted now), api/index.js 12, App.jsx 11, aiService.ts 10, electron/main.cjs 10, SettingsModal.jsx 10, server/package-lock.json 9, main.jsx 9.
- **By lines changed:**
  - Lockfiles: server/package-lock.json 18,582, package-lock.json 6,920, client/package-lock.json 4,700.
  - Code: workspace.css 4,123, WorkspacePage.jsx 4,041, index.css 1,707, aiService.ts 1,477, TodoListPage.jsx 1,448 (deleted), dashboard.css 1,428, SettingsModal 1,336, ai-chat.css 1,168, calendar.css 1,145, AiChatPanel 1,142, DashboardPage.jsx 1,118 (deleted), docs/02-trd.md 962.

### 3.4 Largest blobs in history
1. build/icon.png 281 KB
2. server/package-lock.json 276 KB (old)
3. package-lock.json 213 KB
4. **Peblo_Full_Stack_Developer_Challenge.docx.pdf 170 KB** (confidential)
5. client/package-lock.json 153 KB
6. docs/05-design.md 78 KB
7. docs/02-trd.md 78 KB
8. docs/memory/03-client.md 65 KB
9. docs/03-mcp.md 65 KB
10. workspace.css 60 KB
11. docs/06-go-to-market.md 59 KB
12. WorkspacePage.jsx 57 KB
13. docs/04-ai-hub.md 56 KB
14. docs/memory/05-platform.md 54 KB
15. docs/memory/02-server.md 54 KB

`.git` is 6.1 MB, so purging history (PEB-67) is cheap.

### 3.5 Secrets in history (commit and file only; no values printed)
I grepped every revision for `AIza…`, `sk-…`, `postgres(ql)://user:pass@`, `mysql://user:pass@`, `-----BEGIN`, `password=`, `JWT_SECRET=`, `GOCSPX-`, `ghp_`, `xox[bp]-`, `AKIA…`, `supabase.co` and JWT-shaped strings.

| Commit(s) | File | What (names only) | In memory? |
|---|---|---|---|
| `9ec68f9`, `94b8e07`, `123d430`, `7e2791f`, … (removed in `d45bb8d`) | `server/src/.env` | Supabase Postgres `DATABASE_URL` with password, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `GEMINI_API_KEY`. **Two different Gemini keys** across versions | yes (only `9ec68f9`, one key) |
| **`8ac6634` "Initial commit"** → `a428358`, `ae0f143` | **`".env "`** (filename ends in a **space**, root) | `DATABASE_URL` (SQLite `file:`, harmless), **`JWT_SECRET`, `JWT_REFRESH_SECRET`, `GEMINI_API_KEY`** (39-char `AIza…`, the same key as one of the `server/src/.env` versions) | **No** |
| **`94b8e07`, `4e1c01c`** → removed in `22edb17` | **`server/scratch.js`, `scratch.js`** | a script that tests **three hard-coded Gemini API keys** (`keys = ['AIza…', 'AIza…', 'AIza…']`) | **No** |

- **In total, 4 distinct Google/Gemini API keys appear in history** (by SHA-256 prefix: f173a8c911, 5d1968730c, e2b71c9ad4, f8cc208c68), plus JWT secrets from two files. The memory and PEB-55 name only one key and one file. All three files are reachable from every branch (`main`, `app`, `desktop-app`), so they are on GitHub.
- No `-----BEGIN`, `sk-` (the hit in `docs/05-design.md` is a URL anchor, `…-ask-in-the-command-palette`), AWS, Slack, GitHub-token or Google OAuth client-secret patterns were found.
- `mysql://`/`postgres://` hits in `.env.example`, `docs/DEPLOYMENT.md` and `db.ts:13` are placeholders. `password=` hits are code (`routes/auth.ts:24,47`).
- `client/.env.local` (tracked) holds only `VITE_GOOGLE_CLIENT_ID`, which is public by design.

---

## 4. Dependencies

### 4.1 Root `package-lock.json` (v3, 477 packages: 150 production, 327 dev)
- Production (range → locked): `@google/generative-ai` ^0.21.0 → **0.21.0**, `@prisma/client` ^6.2.0 → 6.19.3, `adm-zip` 0.6.1, `bcryptjs` 2.4.3, `cors` 2.8.6, `dotenv` 16.6.1, `express` 4.22.3, `jsonwebtoken` 9.0.3, `multer` 2.4.0, `openai` 6.49.0, `pdf-parse` 1.1.4, `socket.io` 4.8.4, `uuid` 11.1.1, `zod` 4.6.5.
- Dev: `electron` 44.4.5, `electron-builder` 26.15.3, `esbuild` 0.28.2, `prisma` 6.19.3, `typescript` 6.0.3, `tsx` 4.23.15, `concurrently` 9.2.4, `cross-env` 10.1.0, `wait-on` 9.1.0, `@types/*` (node 25.9.8, express 5.0.6 **while express 4 is installed**, a version mismatch).
- **Deprecated** (lock `deprecated` field): `boolean` 3.2.0, `glob` 7.2.3, `inflight` 1.0.6 (leaks memory), `rimraf` 2.6.3. All four are dev-only (electron-builder/electron toolchain). Not flagged in the lock but deprecated upstream: **`@google/generative-ai`**, the legacy Gemini SDK that Google replaced with `@google/genai` (TRD D12, PEB-89).
- **Licences:** MIT 380, ISC 37, Apache-2.0 19, BSD-3 19, BlueOak-1.0.0 8, BSD-2 6, Python-2.0 1 (`argparse`, dev), WTFPL 1 and WTFPL-or-ISC 1. **Unknown in the lock:** `busboy` 1.6.0 and `streamsearch` 1.1.0 (production, via multer; both are MIT upstream, but the lock has no `license` field). No GPL or other copyleft.
- **Duplicates:** 29 packages are installed in several versions, almost all in the electron-builder toolchain: fs-extra ×6, minimatch ×4, semver ×4, brace-expansion ×3, which ×3, isexe ×3, @electron/get ×2, undici ×2, @types/node ×2, debug ×2, mime ×2.

### 4.2 `client/package-lock.json` (v3, 309 packages: 268 production, 41 dev)
- Production:
  - Editor: `@blocknote/core|mantine|react` 0.51.4, `@mantine/core|hooks` 9.3.0.
  - Data and routing: `@tanstack/react-query` 5.101.0 (+ devtools 5.101.0, unused), `axios` 1.16.1, `react`/`react-dom` 19.2.7, `react-router-dom` 7.15.1, `socket.io-client` 4.8.3, `zustand` 5.0.14.
  - Utilities: `diff` 9.0.0, `framer-motion` 12.40.0, `html2pdf.js` 0.14.0, `lucide-react` 1.16.0, `marked` 15.0.12.
  - Unused: `react-window` 2.2.7, `tailwindcss` and `@tailwindcss/vite` 4.3.0.
  - Fonts: 11 × `@fontsource/*` 5.3.0.
- Dev: `vite` 6.4.2, `@vitejs/plugin-react` 4.7.0, `@types/react` 19.2.16, `@types/react-dom` 19.2.3.
- Deprecated: none.
- **Licences other than MIT/ISC/BSD/Apache:**
  - **MPL-2.0: `@blocknote/core`, `@blocknote/mantine`, `@blocknote/react`** (weak, file-level copyleft). Shipping them is fine, but modified BlockNote files must be published, and the licence notice must ship with the app.
  - **OFL-1.1:** all 11 font packages. The licence text must accompany the fonts.
  - `dompurify` 3.4.7: MPL-2.0 OR Apache-2.0 (choose Apache).
  - `lightningcss` (+13 platform binaries): MPL-2.0. Build-time only, via Tailwind, which is itself unused.
  - `caniuse-lite`: CC-BY-4.0 (dev).
  - **`xmlhttprequest-ssl` 2.1.2: unknown licence in the lock** (production, via socket.io-client; MIT upstream).
- There is no LICENSE or third-party NOTICES file in the repo (PEB-67 mentions only LICENSE).
- Duplicates: only `@types/use-sync-external-store`.
- `vite.config.js` `manualChunks.ui = ['lucide-react','framer-motion']` forces framer-motion into the eagerly loaded `ui` chunk next to the icons everyone uses. Only `TodoItem`/`TodoEditModal` (under `TodoListPanel`) use it, so every user downloads it at start-up.

### 4.3 What the Electron package pulls in
- `build.files` includes `node_modules/**/*` (`package.json` build section). electron-builder still copies **only the production dependency tree** of the root `package.json` (150 packages); devDependencies such as electron, electron-builder, typescript, esbuild and prisma are excluded, and `electron`, `prisma` and `@prisma/engines` are also excluded explicitly. `client/node_modules` is not shipped (only `client/dist`). So the main concern is not dev tools leaking in, but:
  - The **server is not bundled**: `scripts/build-server.mjs:1-2,20-28` transpiles file by file with no bundling, so production `node_modules` must ship whole.
    - **`pdf-parse` 1.1.x ships several full copies of pdf.js** (`lib/pdf.js/v1.9.426`, `v1.10.88`, `v1.10.100`, `v2.0.550`), several MB.
    - `openai` (types, plus ESM and CJS builds).
    - The `socket.io` + `engine.io` + `ws` stack.
    - `@prisma/client` runtime plus `server/generated/prisma` (query engine binary, about 15–20 MB per platform, asarUnpacked).
  - **Source maps:** `esbuild sourcemap: true` produces `dist/server/**/*.map`, but `!**/*.map` excludes them. Fine.
  - The production tree includes `uuid`, `dotenv` and `cors`. They are small, but no license/NOTICE collection step exists.

---

## 5. Requirements from product docs vs code today

Legend: Done / Partial / Missing / Superseded. "Doc" is the Pri/Phase in 01-prd. The doc's own Status column dates from the SQLite build; the **Code** column is what I verified now.

### 5.1 PRD (01-prd.md §5)

| ID | Asks | Doc | Code today (evidence) | Jira |
|---|---|---|---|---|
| CAP-01 | Global quick capture + NL parsing | P0/1 | **Done**: `CAPTURE_SHORTCUT` `main.cjs:40`, `QuickCapturePage.jsx`, `utils/parseTask.js` | PEB-80 (parser bugs) |
| CAP-02 | Time, recurrence, reminder parsing | P1/1 | **Missing**: parseTask has dates, `!prio` and `#tag` only | PEB-80 (times only) |
| CAP-03 | Inbox view with triage | P1/1 | **Partial**: `inbox` tag + sidebar "Inbox" view (`NotesSidebar.jsx:57-61`), Orbit hides it (`orbitUtils.js:5`); no triage or badge | **none** |
| CAP-04 | Smart Intake with review step | P0/1 | **Missing in the UI**: server `POST /ai/smart-intake(-upload)` (`aiChatController.ts:292`) saves immediately; the only caller is the dead `AiChatPanel.jsx:303-306` | PEB-94, PEB-42 |
| CAP-05 | Multi-file, long-PDF intake | P1/1 | Missing | PEB-42 (loosely) |
| CAP-06 | Import Notion, Obsidian, .md | P0/1 | **Done**: `services/importService.ts`, `routes/transfer.ts` | PEB-37 |
| CAP-07 | Import images + `[[wikilinks]]` | P1/1 | Missing (images skipped, as the smoke test asserts) | PEB-37 / PEB-98 |
| CAP-08 | Todoist/TickTick CSV, `.ics` import | P2/2 | Missing (no `.ics` code anywhere) | PEB-97 |
| CAP-09 | Capture via MCP | P0/1 | Missing | PEB-95 |
| CAP-10 | Local voice transcription | P2/2 | Partial (voice call/commands, no local STT) | PEB-45 |
| CAP-11 | Web clipper / share target | P2/2 | Missing | none |
| KN-01 | Block editor, tags, archive, trash, versions, export | P0/1 | **Done**: BlockEditor, backups, exports in `EditorToolbar.jsx:104-112` | PEB-35, PEB-83 |
| KN-02 | `[[` autocomplete + backlinks | P1/1 | **Partial** (memory says Missing): title-substring backlinks in `NoteContextPanel.jsx:35-42`; no `[[` links | PEB-98 |
| KN-03 | Ranked full-text search across notes and tasks | P0/1 | Partial: Prisma `contains` on notes; Hub keyword scoring over notes + tasks (`retrieval.ts:75-85`) | PEB-19, PEB-93 |
| KN-04 | Semantic / hybrid search | P0/1 | Missing (`note_embeddings` unused) | PEB-93 |
| KN-05 | Ask your notes with citations | P0/1 | Partial: `/api/ai/hub/chat` SSE with numbered sources, note-level only | PEB-43, PEB-93 |
| KN-06 | Attachments | P1/1 | Missing | **none** |
| KN-07 | Related notes | P2/2 | Missing (Orbit has a hub-search "related" list, `OrbitNotes.jsx:61`) | none |
| KN-08 | Daily note | P2/1 | Missing | none |
| KN-09 | Templates | P2/2 | Missing (intake "templates" are prompt hints only, `aiService.ts:569`) | none |
| ACT-01 | Tasks with priority, deadline, time, tags, note link | P0/1 | **Done** (tags still JSON) | PEB-38 |
| ACT-02 | RRULE recurrence series | P0/1 | Partial (30/12/12/5 copies) | PEB-76 |
| ACT-03 | Native reminders from a background process | P0/1 | Partial (renderer "AI voice call"; main `Notification` only for the tray hint, `main.cjs:225`) | PEB-92 |
| ACT-04 | Calendar month and day views | P0/1 | **Done** | PEB-39, PEB-79 |
| ACT-05 | Week view with time blocking | P1/1 | Partial (week views in Soft/River/Orbit, `SoftCalendar.jsx:13`, `OrbitDue.jsx:115`; no drag-to-slot) | PEB-39 (loosely) |
| ACT-06 | ICS subscribe; Google/Outlook sync | P1-P2/1-2 | Missing | **none** |
| ACT-07 | Today/Upcoming with overdue handling | P0/1 | Partial | PEB-40 |
| ACT-08 | Projects, subtasks | P2/2 | Missing | none |
| ACT-09 | Daily briefing / weekly review | P1/1 | **Done** (`/dashboard/daily-briefing`, `/weekly-report`, morning voice briefing in `AiVoiceCallManager.jsx:45`); not a HUB-09 automation | PEB-40, PEB-45 |
| HUB-01 | `/ai` page + shortcut | P0/1 | **Done**: route `App.jsx:97`; Ctrl/Cmd+J `AppShell.jsx:33-44` (memory says "not verified") | PEB-43 |
| HUB-02 | Per-conversation model picker with badges | P0/1 | Partial/near done (`useHubChat` modelChoice, local/cloud labels) | PEB-43 |
| HUB-03 | Grounded chat with citations | P0/1 | Partial (keyword RAG) | PEB-43, PEB-93 |
| HUB-04 | Scope control, `#private` excluded | P0/1 | Partial (attach notes, `#private` filter `retrieval.ts:87`) | PEB-43, PEB-64 |
| HUB-05 | Conversation history: searchable, deletable, exportable | P0/1 | Partial (localStorage `peblo-ai-hub-v1`, deletable; not searchable or exportable) | PEB-27 |
| HUB-06 | Actions from chat with preview/confirm | P0/1 | Partial (Hub "Save as note"; no tasks or confirm) | PEB-94, PEB-64 |
| HUB-07 | Connections manager | P0/1 | Partial (`ConnectionsPage.jsx`, MCP block "Coming next" :179-187) | PEB-44 |
| HUB-08 | Any OpenAI-compatible endpoint | P1/1 | Missing (only Ollama `/v1`, `aiService.ts:56`) | **none** (PEB-89 is the SDK) |
| HUB-09 | Agents / automations | P1/1 (P0 in phase 2) | Missing | **none** |
| HUB-10 | Editable prompt library | P1/1 | Missing | **none** |
| HUB-11 | Usage, token and cost display | P2/1 | Missing | PEB-26 (limits, not display) |
| HUB-12 | AI-off switch | **P0/1** | Missing (`noAI` just means no models configured, `useHubChat.js:91`) | **none** |
| HUB-13 | Hardware-aware model guidance | P1/1 | Missing | **none** |
| MCP-01..09 | Local stdio MCP server, tools, setup, permissions, audit, safe writes, resources, limits, HTTP | P0×6, P1×2, P2×1 | **All Missing** (only a placeholder card) | PEB-95 (one ticket for all nine) |
| CON-01 | Add an external MCP server | **P0/1** | Missing | **none** (PEB-44 is the screen only) |
| CON-02 | Per-tool approval | **P0/1** | Missing | **none** |
| CON-03 | Visible tool calls | **P0/1** | Missing | **none** |
| CON-04 | Untrusted-content guardrails | **P0/1** | Missing | **none** (PEB-64 covers AI safety in general) |
| CON-05..06 | Presets; health errors | P1/1 | Missing | **none** |
| CON-07 | Automations use Connect | P1/2 | Missing | none |
| DATA-01 | Full export | P0/1 | Partial (notes Markdown zip, `transfer.ts:54`) | PEB-97 |
| DATA-02 | Automatic backups + pre-migration snapshot | P0/1 | Missing | PEB-30 |
| DATA-03 | Secrets in the OS keychain | P0/1 | Partial (AES-GCM in MySQL, but decrypted to the renderer) | PEB-12, PEB-58, PEB-59 |
| DATA-04 | Local API protected | P0/1 | **Superseded/Done** by JWT accounts + socket auth; permissive localhost CORS remains (`index.ts:48`) | PEB-10, PEB-13, PEB-65 |
| DATA-05 | Encryption at rest | P1/2 | Missing | none |
| DATA-06 | Storage adapters / Markdown vault | P0 (vault)/2 | Missing | **none** |
| DATA-07 | E2E multi-device sync | P0/2 | Missing (hosted MySQL instead) | **none** (PEB-56 is related) |
| DATA-08 | Delete everything | P1/1 | Missing (no account-delete route) | PEB-25 |
| PLAT-01 | Desktop app Win/mac/Linux | P0/1 | **Done** but fragile (fresh install, mac x64) | PEB-50, PEB-54, PEB-57, PEB-71 |
| PLAT-02 | Signing/notarisation | P0/1 | Missing | PEB-96 |
| PLAT-03 | Auto-update | P0/1 | Missing (no `electron-updater`) | PEB-96 |
| PLAT-04 | Opt-in telemetry and crash reports | **P0/1** | Missing (no `crashReporter`/Sentry) | **none** |
| PLAT-05 | CLI | P1/1 | Missing | **none** |
| PLAT-06 | Keyboard-first Ctrl+K | P1/1 | Partial (`CommandPalette.jsx`; broken on Notes) | PEB-51, PEB-78 |
| PLAT-07 | Mobile companion | P0/2 | Missing | **none** (PEB-34 is responsive web) |
| PLAT-08 | Web client | P2/3 | Partial (hosted mode serves the SPA, `index.ts:73-79`) | PEB-20, PEB-34 |
| PLAT-09 | Plugin API | P2/3 | Missing | none |
| PLAT-10 | First-run onboarding | **P0/1** | Missing (only AuthScreen) | **none** |

### 5.2 AI Hub features (04-ai-hub.md, all Phase 1)

| ID | Status | Jira |
|---|---|---|
| F1 model picker + OpenAI-compatible endpoints | Partial (Ollama auto-detect; no generic endpoint) | PEB-43 |
| F2 streaming chat, local history; rename, pin, search, export | Partial (stream, stop and regenerate yes; rename, pin, search and export no) | PEB-27, PEB-43 |
| F3 RAG with citations | Partial | PEB-93 |
| F4 `@`-attach notes and files | Partial (attach notes via picker; no files) | PEB-43 |
| F5 tool use with approval, Connect | Missing | PEB-94 / none for Connect |
| F6 automations | Missing | none |
| F7 hardware hints, model pull | Missing | none |
| F8 prompt templates as files | Missing | none |
| F9 save answer as note + Quick ask | Partial (Save as note in `useHubChat`; Quick ask = dead AiChatPanel) | PEB-41 |

### 5.3 TRD known defects D1–D17 (02-trd.md:104-120)

| D | Problem | Code today | Jira |
|---|---|---|---|
| D1 | `p.model` ReferenceError | **Fixed** (`01d544b`; `p` now in loop scope, `aiService.ts:133-174`) | – |
| D2 | Silent local→cloud fallback | Partial ("Local only" mode, `aiService.ts:83-121,1009-1028`; bypassable per memory S-11) | PEB-64 |
| D3 | Unauthenticated local API, socket join | **Fixed** (JWT middleware, authenticated sockets `66cf624`) | PEB-10, PEB-11 |
| D4 | Plain-text keys | Partial (encrypted at rest; decrypted to client + localStorage) | PEB-12, PEB-59 |
| D5 | API in the Electron main process | **Missing** | **none** (only mentioned in memory) |
| D6 | Stack traces in errors | **Fixed** (dev only, `errorHandler.ts:18`); `npm start` runs as development | PEB-66 |
| D7 | Migration runner `;\n` split, no backup | Partial (MySQL now; same split, no lock or backup) | PEB-72, PEB-30 |
| D8 | Lossy Markdown storage | **Unchanged** (`BlockEditor.jsx:38` `blocksToMarkdownLossy`) | **none** |
| D9 | Recurrence as copies | Unchanged | PEB-76 |
| D10 | Partial version history | Unchanged | PEB-83 |
| D11 | No pagination/search index | Partial (optional `limit≤500`, `notesController.ts:85-86`; default still all) | PEB-19, PEB-28 |
| D12 | Monolithic AI service, deprecated SDK | Unchanged | PEB-89 |
| D13 | Settings split-brain | **Unchanged** (`AuthContext.jsx:71` `{...u.settings, ...prev}`) | PEB-82 / PEB-59 |
| D14 | No CSP | Unchanged | PEB-65 |
| D15 | Unsigned builds, no update or crash reports | Unchanged | PEB-96 (crash reporting: none) |
| D16 | Global tags | **Fixed** (`Tag.userId`, `schema.prisma:67-73`) | PEB-11 |
| D17 | Big components | Worse (WorkspacePage 1,115 lines, SettingsModal 733) | PEB-88 (dead code only) |

### 5.4 ADRs (02-trd.md §6)

| ADR | Decision | Status |
|---|---|---|
| 1 | Stay on Electron | Followed |
| 2 | better-sqlite3 + Kysely behind StorageAdapter | **Reversed**: the app moved to Prisma + MySQL (`3a0f1a3`); the ADR is stale |
| 3 | Vector search (sqlite-vec) | Not started |
| 4 | Hybrid sync | Not started; replaced by the hosted MySQL |
| 5 | Local-first, three privacy modes | Partial (Local only / Ask first / cloud routing) |
| 6 | npm workspaces `packages/*` | Not done |
| 7 | HTTP + SSE with a per-launch token, replace Socket.IO | Not done (JWT + Socket.IO) |

The memory's 07-history notes that the docs are stale, but it **never flags ADR-2 and ADR-7 as contradicted by what was built**.

### 5.5 05-design.md audit items A1–A20 (selected; full list at 05-design:73-92)
- A4 invalid `rgba(var(--hex))`: there are still **30** `rgba(var(` uses (e.g. `calendar.css:78`). They are valid only where the variable is an `r,g,b` triple (`--dash-primary-rgb`).
- A5 parallel `--dash-*` set: still present (`dashboard.css:7`).
- A6 inline styles: 234 → **402**.
- A8 `MOBILE_NAV_TABS` (`navTabs.jsx:30`): still present.
- A13 five AI surfaces: AiChatPanel is still there (dead) with its Ctrl+Shift+A handler (`AiChatPanel.jsx:226`).
- A17 focus/motion: partly fixed (§2.5).
- A19 start-up flash: still present for dark themes (§2.1).

None of these has a dedicated Jira issue; the closest are PEB-33 (accessibility) and PEB-88/90.

### 5.6 P0/P1 (Phase 1) requirements with NO Jira issue
- **P0:** HUB-12 (AI-off switch), CON-01, CON-02, CON-03, CON-04 (Peblo Connect, i.e. Peblo as an MCP client), PLAT-04 (telemetry and crash reports), PLAT-10 (onboarding).
- **P0, Phase 2:** DATA-06 (Markdown vault), DATA-07 (E2E sync), PLAT-07 (mobile).
- **P1:** CAP-03 (Inbox triage), KN-06 (attachments), ACT-06 (ICS/external calendars), HUB-08 (OpenAI-compatible endpoints), HUB-09 (automations), HUB-10 (prompt library), HUB-13 (hardware guidance), CON-05, CON-06, PLAT-05 (CLI).
- **TRD defects with no ticket:** D5 (API in the main process), D8 (lossy note storage), and D15's crash-reporting half.
- **Weak coverage:** MCP-01..09 (six P0) all sit in a single PEB-95.

---

## 6. Spot-check of 12 memory claims

| # | Claim (file:line in memory) | Verdict |
|---|---|---|
| 1 | `db.ts` throws on import without `DATABASE_URL` (db.ts:10-15) and tries two Prisma paths (22-30) (02-server:13) | Correct (`db.ts:10-15`, `:24-27`) |
| 2 | CORS allows no Origin, any localhost port and ALLOWED_ORIGINS (02-server:28-29) | Correct (`index.ts:45-52`) |
| 3 | `ai.ts` mounted twice (`/api/notes` and `/api/ai`) (02-server:600) | Correct (`index.ts:63-64`) |
| 4 | Link preview: no timeout, size cap or private-IP block (02-server:286) | Correct (`aiController.ts:246-262`) |
| 5 | `toggle-task` without id updates all todos (02-server:560) | Correct (`dashboardController.ts:155-160`, `updateMany({where:{id,userId}})`) |
| 6 | Voice sends trashed note titles (02-server:576) | Correct (`aiController.ts:128-131`, filters only `isArchived:false`) |
| 7 | Title fallback key `{title}` vs `{suggested_title}` (02-server:584) | Correct (`aiService.ts:12` vs `:536`) |
| 8 | Retrieval loads all notes' full content (02-server:612) | Correct (`retrieval.ts:75-85`) |
| 9 | POST /notes ignores `isArchived` (02-server:130) | Correct (`notesController.ts:191-199`) |
| 10 | Ctrl+K broken on Notes: capture listener + stopPropagation (03-client:373) | Correct (`hooks/index.js:121,125`; palette bubble listener `CommandPalette.jsx:30`) |
| 11 | `GET /profile` returns decrypted keys (03-client:360) | Correct (`services/profile.ts:17-23`) |
| 12 | PDF export `container.innerHTML = marked.parse(noteContent)` at `WorkspacePage.jsx:371` (03-client:366) | **Imprecise**: the injection is a template string at `:371-376`, and **`noteTitle` is also interpolated raw** at `:373` (a second HTML-injection vector the memory doesn't mention) |
| + | Voice invalidates non-existent keys `['todayTasks']` etc. (03-client:378) | Correct (`AiVoiceCallModal.jsx:446-449`) |
| + | useHubChat ignores `res.ok`, unguarded `JSON.parse` (03-client:394) | Correct (`useHubChat.js:142-159`) |
| + | `client/.env.local` only holds `VITE_GOOGLE_CLIENT_ID`, unused (03-client:14) | Correct (0 references) |

Other inaccuracies found along the way:
- 05-platform:3 "remotes `origin`, `pc`": `pc` is not configured, only a stale ref.
- 05-platform §6.2 and 06-issues G-08 call KN-02 backlinks "Missing": they are Partial (`NoteContextPanel`).
- 05-platform §6.2 says HUB-01's shortcut is "not verified": it exists (`AppShell.jsx:33-44`).
- The memory's secret-leak record (05-platform:377, S1, 06-issues S-02/PEB-55) lists one file and one key; history has **three files and four Gemini keys plus JWT secrets** (§3.5).
- CLAUDE.md's route-mount order omits `aiChatRoutes` and the duplicate `aiRoutes` mount.
- 05-design A17 is outdated (§2.5).

---

## Notes for the main session (worth saving to memory)
- The GitHub default branch is `main`, which is the obsolete web app; `app` is the product. `desktop-app` is a stale local-only wip branch.
- Additional leaked secrets: `".env "` (with a trailing space, Initial commit `8ac6634`), plus `scratch.js` and `server/scratch.js` (`94b8e07`, `4e1c01c`, 3 Gemini keys). Rotate all 4 Gemini keys and both JWT secrets, then purge history.
- Missing tickets: HUB-12, CON-01..04, PLAT-04 and PLAT-10 are P0 with no Jira issue.
