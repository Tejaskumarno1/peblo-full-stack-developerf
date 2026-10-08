# Peblo client: the five UI styles (reverse-engineering report)

Repo: `the repo`. Read-only analysis. Line numbers are 1-based for the file named.

Scope read in full: `client/src/orbit/*`, `client/src/river/*`, `client/src/soft/*` (CSS files skimmed and checked for unused selectors), `client/src/App.jsx`, `client/src/components/shell/*`, `server/src/routes/river.ts`, `server/src/routes/study.ts`. Also checked for context: `context/AuthContext.jsx`, `components/SettingsModal.jsx` (style picker), `components/CommandPalette.jsx`, `pages/QuickCapturePage.jsx`, `api/index.js`, `hooks/useNoteDoc.js`, `utils/parseTask.js`, `components/hub/{HubScreen,ConnectionsScreen}.jsx` (prop and prefix API only), `server/src/services/aiService.ts` (`makeQuiz`, `findPromises`, `meetingBrief`), `server/prisma/schema.prisma` (QuizRun, TopicMastery, AiGeneration).

---

## 1. How style selection works

**Where it is stored.** `AuthContext.jsx:19-21` holds `uiStyle` in React state. It starts from `localStorage['peblo-style']` and falls back to `'studio'`. `setUiStyle` (`AuthContext.jsx:169-172`) writes it back to `localStorage['peblo-style']`. The style is saved per device only. Unlike `settings`, it is not synced to the account or profile. An effect (`AuthContext.jsx:62-64`) also sets `data-style="<style>"` on `<body>` and `<html>`, which `styles/shell-styles.css` uses for per-style touches (for example `[data-style="console"] ...`).

**Default style.** `studio`.

**Where the user picks it.**
- Settings → Appearance → "Style", a radio grid of cards (`SettingsModal.jsx:295-299`).
- Command palette (Ctrl/Cmd+K). It shows a "Change style to X" entry for each style except the current one (`CommandPalette.jsx:58-60`).

**The five styles** (id → display name, description and tags from `SettingsModal.jsx:295-299`):

| id | Display name | Description | Tags | Tooltip intent |
|---|---|---|---|---|
| `studio` | Studio | Sidebar and calm serif headings | Everyday, Writers | Familiar sidebar, big writing area (default) |
| `console` | Console | Keyboard-first, command bar, dense | Developers, Power users | Everything from the keyboard |
| `soft` | Soft Studio | Friendly tiles and a floating dock | Beginners, Visual | Big pastel tiles, less to read |
| `river` | River | Your day as one timeline, past to future | Meetings, Planners | Notes, meetings and tasks on one timeline; finds promises in meetings |
| `orbit` | Orbit | A map of what you know, built for studying | Students, Exams | Topics as a map with mastery scores; quizzes from your own notes |

**How the style is applied.**
1. **Frame or shell.** `AppShell.jsx:61-79` returns `ConsoleShell` for console, `SoftShell` for soft, `RiverShell` for river, `OrbitShell` for orbit, and otherwise (studio, or any unknown value) the Studio layout: `<Sidebar>` plus `<main class="pb-sheet">`. `SettingsModal` is mounted by AppShell in every style.
2. **Screens.** `App.jsx:49-53` defines `<Styled soft={..} river={..} orbit={..} other={..}>`, which picks `byStyle[uiStyle] || other`. Studio and Console both get `other`, the shared pages (`HomePage`, `WorkspacePage`, `TasksPage`, `CalendarPage`, `AIHubPage`, `ConnectionsPage`). Route map (`App.jsx:91-98`):

| Route | Studio / Console | Soft | River | Orbit |
|---|---|---|---|---|
| `/` | HomePage | SoftHome | RiverHome (zoom from storage, default day) | OrbitHome (returns `null`; the shell draws the map) |
| `/notes`, `/notes/:id` | WorkspacePage | SoftNotes | RiverNotes | OrbitNotes |
| `/tasks` | TasksPage | SoftTasks | RiverHome `initialZoom="day"` | OrbitDue `view="list"` |
| `/calendar` | CalendarPage | SoftCalendar | RiverHome `initialZoom="week"` | OrbitDue `view="week"` |
| `/quiz/:topic` | redirect to `/` (GoHome) | GoHome | GoHome | **OrbitQuiz** (only Orbit has it) |
| `/ai` | AIHubPage | SoftAI | RiverAI (HubScreen `p="r"`) | OrbitAI (HubScreen `p="o"`) |
| `/ai/connections` | ConnectionsPage | SoftConnections | RiverConnections (ConnectionsScreen `p="r"`) | OrbitConnections (ConnectionsScreen `p="o"`) |

3. **Quick-capture window** (Ctrl+Shift+Space, route `/quick-capture`). `QuickCapturePage.jsx:12-24` renders `SoftCapture`, `RiverCapture` or `OrbitCapture` with `windowMode`, wrapped in `.soft/.river/.orbit` plus `*-window`. Studio and Console get the generic `QuickCapturePage`.

**What every style shares** (the AppShell and App layers): the `CommandPalette` (Ctrl+K), `AiVoiceCallManager`, the Ctrl/Cmd+J → `/ai` hotkey (skipped on `/notes/:id`, `AppShell.jsx:35-45`), and the `peblo:open-settings` window event.

### Studio (default, "classic")
`components/shell/Sidebar.jsx` provides:
- brand ("<First>'s workspace")
- a collapse toggle, persisted in `localStorage['peblo-sidebar-collapsed']` (`AppShell.jsx:14-16, 26-31`)
- a "Search or ask… Ctrl K" button that fires a synthetic Ctrl+K keydown (`openCommandPalette`, `Sidebar.jsx:14-16`)
- nav: Home, Inbox (`/notes?tag=inbox` with a count), Notes, Tasks (open count = today + overdue), Calendar, AI Hub (Ctrl J)
- the 3 most recent notes and the top 5 tags (excluding `private`)
- a "Saved to your account" trust box showing the model line (local, cloud, warn or off) and the routing label (`ollama | ask | auto | openai | gemini`)
- avatar, theme cycle (light → dark → midnight), Settings

Queries: `GET /notes?sort=updated`, `GET /todos/today`, `GET /ai/hub/models` (refetched every 60 s).

### Console
`components/shell/ConsoleShell.jsx` provides:
- **Icon rail**: Home, Notes, Tasks, Calendar, AI Hub, a "+" link to `/tasks?add=1`, theme, `/ai/connections`, Settings.
- **Command bar** "> ask your notes anything". Submitting text goes to `/ai?q=...`. Submitting an empty line opens the command palette.
- Model pill and an initials avatar (opens Settings).
- **Status bar**: "saved to your account · N notes · M open tasks", plus key hints (ctrl k, ctrl j, ctrl shift space).

Data comes from `useShellData.js`, which runs the same three queries as Sidebar. Page content is identical to Studio.

---

## 2. Each style in detail

### 2.1 Soft Studio (`client/src/soft/`)

**Concept.** A friendly pastel UI: big rounded tiles in peach, mint, butter, lilac and sky, a header with a search pill, and a floating bottom **dock**. Each tag gets a stable pastel colour (`softUtils.toneOf`: fixed map for common tags, otherwise a hash into 5 tones).

**Shell (`SoftShell.jsx`).**
- Header: blob logo "peblo", a search button that opens the command palette, a theme cycle button, and an avatar initial that opens Settings.
- Dock: Home, Notes, Tasks, Calendar, AI Hub, Your AI, and a **Capture** button.
- The capture overlay opens on the dock button or on the window event `peblo:capture`.

**Screens and features.**

- **SoftHome (`/`)**
  - Hero:
    - date pill
    - generated headline: "Hey <name>, two small things and you're free." / "nothing is due today" / "N things…"
    - lead sentence: first task, the next high-priority item this week, or the overdue count
  - "Ask Peblo about your notes" box. It navigates to `/ai?q=` and offers three chips: "Plan my day", "Quiz me on #<top tag>", "Sum up my week". These are all plain chat prompts; there is no real quiz engine here.
  - Four tiles:
    - **Today**: up to 3 open tasks sorted by priority then time, toggle checkbox, "+N more", a "left over from yesterday" link, or "Add a task for today", which opens capture.
    - **Coming up**: the next 1–7 days that have items, up to 3 days. The first day containing a high-priority item gets a "big" white card. Links to `/calendar`.
    - **Notes**: 3 latest notes as tilted "papers", plus a "+" button to `/notes?new=1`.
    - **Streak**: `insights.streakStats.current`, the last 7 days of `activityHeatmap` as dots, and a privacy/AI line.
  - API: `GET /todos/today`, `GET /todos/range?from=today+1&to=today+8`, `GET /notes?sort=updated`, `GET /dashboard/insights`, `GET /ai/hub/models`, `PATCH /todos/:id` (toggle, with an optimistic update of the `['todos','today']` cache).
- **SoftNotes (`/notes[/:id]`)**: a three-column layout (list | editor | helpers). It has its **own** editor and save logic (it does **not** use `useNoteDoc`).
  - List:
    - filter tabs: All, Inbox (with count), the top 2 tags, plus the current filter if it is a tag
    - Archive and Trash links in the footer
    - rows show tone dot, title, snippet and relative time
    - visiting `/notes` with no id auto-opens the most recent note (`SoftNotes.jsx:87-89`)
  - Editor:
    - breadcrumb, save status, Preview/Edit toggle, Restore when the note is in Trash
    - ··· menu: Archive/Unarchive, Export as Markdown (client-side Blob), Move to Trash / Delete forever (with `confirm`)
    - title input, tags with remove buttons and an inline "+ tag" input
    - BlockEditor
  - **Selection pill**: select 3 or more characters in the body to get **Explain**, **Make a task** (creates a todo linked by `noteId`) and **Quiz me**. Explain and Quiz me navigate to `/ai?q=...&note=<id>&noteTitle=...`.
  - Helper column:
    - "Ask about this note" box with chips Summarise, Flashcards and Find tasks, which also go to `/ai` with the note attached
    - **Linked tasks** (`GET /todos?noteId=`) with toggle
    - **Mentioned in**: other notes whose content contains this note's title (title length 4 or more, client substring match, max 4)
    - **Version history**: `GET /notes/:id/backups`; "Restore · <time>" calls `POST /notes/:id/backups/:backupId/revert`
  - Draft creation: id `__draft__`, created on the first non-empty autosave (`useAutoSave` from `../hooks`).
  - API: `GET /notes?sort=updated[&tag|archived|deleted]`, `GET /notes/:id`, `POST /notes`, `PATCH /notes/:id`, `POST /notes/:id/archive`, `DELETE /notes/:id`, `POST /notes/:id/restore`, `GET /notes/:id/backups`, `POST /notes/:id/backups/:bid/revert`, `GET /todos?noteId=`, `POST /todos`, `PATCH /todos/:id`.
- **SoftTasks (`/tasks`)**
  - Board columns: **Today** (overdue plus today), **Tomorrow**, **This week** (days 2–6, then a "Later" divider for undated tasks or tasks more than 6 days out), **Done** (completed in the last 7 days by `updatedAt`, max 12).
  - List view shows the same groups. A "Timeline" tab just navigates to `/calendar`.
  - Subtitle: "N to do · M done this week · one from <day> still waiting".
  - Add bar uses `parseTask` (today, tonight, tomorrow, weekday, `!high|!low`, `#tag`) with live chips. Note: a parsed deadline is saved at **17:00** (see the bugs section).
  - Cards: checkbox, chips (late "From yesterday", time, day chip, High, up to 2 tags), link to the task's note, delete with confirm.
  - API: `GET /todos`, `POST /todos`, `PATCH /todos/:id`, `DELETE /todos/:id`.
- **SoftCalendar (`/calendar`)**: read-only.
  - Day, Week and Month views, prev/today/next.
  - Weeks start on **Sunday**.
  - Hour grid is at least 09–22 and stretches to fit tasks.
  - All-day row: tasks with no time (deadline at 23:59 and no `startTime`).
  - Overlapping events are split into lanes (`layout`).
  - Now line.
  - Mini month with busy dots.
  - **"Next big thing"** countdown: the next high-priority open item in 60 days, else the next item; shown as Today / Tomorrow / N days.
  - Clicking an event opens its note, or `/tasks`.
  - API: `GET /todos/range` twice (visible range, and today → +60 days).
- **SoftCapture** (dock overlay and the capture window)
  - Task or Note mode (Tab switches, Esc closes).
  - Task mode: `parseTask` preview chips; **suggests linking a note** whose title shares a word of 4+ letters; warns **"Looks similar"** when an open task in −7…+30 days shares a word. Creates `POST /todos` with an optional `noteId`.
  - Note mode: title is the first line, tag `inbox`, via `POST /notes`.
  - API also: `GET /todos/range`, `GET /notes`.
- **SoftAI (`/ai`)**: its own three-pane chat UI built on `useHubChat`.
  - Chat list with delete ("Chats stay on this computer").
  - Thread with citation clicks, a cloud-consent bubble, error with retry, actions Save as note / Copy / Try again, and follow-up chips "Quiz me on this", "Explain it more simply", "Make flashcards from this".
  - Composer with "+ Add a note" attachment and a model picker (Automatic, local Ollama models, cloud models; cloud is disabled when routing is `ollama`).
  - "Where this came from" sources panel, with a count of private notes left out.
  - Backend calls are inside `useHubChat` (not in scope).
- **SoftConnections (`/ai/connections`)**
  - Routing radio with 3 choices (`ollama`, `ask`, `auto`) that saves `defaultAiModel`.
  - Ollama card: turn on/off, "Test connection" (`GET /ai/ollama/check?url=`), installed models with "Use for chat" / "Use for search", status.
  - Cloud keys (OpenAI, Gemini) saved through `updateSettings`.
  - "Coming next" MCP teaser card.
  - API: `GET /ai/hub/models`, `GET /ai/ollama/check`, plus `PUT /profile` via `updateSettings`.

**Utility logic (`softUtils.js`).**
- Tone hashing.
- `startOfDay`, `addDays`, `sameDay`, `daysFromToday`.
- `timeOf`: returns `startTime`, `''` for 23:59 all-day, else HH:mm.
- `spanOf`: start and end hours; the default length is 1 h, or 1.5 h for high priority.
- `dayChip`, `relTime`, `numberWord`.
- `snippetOf`: strips markdown and table pipes.
- `firstNameOf`.

River and Orbit **import these helpers**: `riverUtils` re-exports `startOfDay`, `addDays`, `sameDay`, `spanOf`; Orbit imports `startOfDay`, `firstNameOf`, `snippetOf`.

**localStorage keys.** None of its own. It uses the shared `peblo-style`, `peblo-theme` and `peblo-settings`.

---

### 2.2 River (`client/src/river/`)

**Concept.** "Your day as one timeline, past to future." There is one horizontally scrolling river with lanes **MEETINGS**, **TASKS**, **NOTES** and **PEBLO** (AI suggestions). A **meeting** is any todo with both a `deadline` and a `startTime` (`riverUtils.isMeeting`). Tasks and Calendar are the same screen at different zooms. A drawer under the river shows the selected item.

**Shell (`RiverShell.jsx`).** `RiverShell` is only the `.river` wrapper plus a capture overlay opened by the `peblo:capture` event. Each screen renders `RiverHeader`, which contains:
- brand
- nav: River (`/`), Notes, Ask Peblo (`/ai`). There is **no Tasks or Calendar link**.
- a screen-specific centre slot and tools
- a "+" capture button (dispatches a plain `Event('peblo:capture')`)
- avatar menu: Your AI and privacy, theme switch, Settings

`useDismiss` (outside-click or Esc closes a popover) is exported here. Orbit has its own copy.

**Screens and features.**

- **RiverHome (`/`, `/tasks`, `/calendar`)**

  **Zoom levels** (`riverUtils.ZOOMS`), persisted in `localStorage['peblo-river-zoom']`:

  | Zoom | Mode | Scale | Range |
  |---|---|---|---|
  | Hours | time | 150 px/h | −3 to +14 days |
  | Day | time | 78 px/h | −7 to +30 days |
  | Week | bins of 1 day | 200 px each | −14 to +42 days |
  | Quarter | bins of 1 week | 150 px each | −28 to +98 days, starting on a Monday |

  In time zooms the night (22:00 → 08:00) folds into a 40 px band (`xOf`, `dayWidth`).

  **Header:** today's date, "<clock> · next up in X" (next unfinished meeting or task), a **Jump** search, and zoom buttons.
  - Jump results: Today / Tomorrow / Yesterday; "Next <weekday>"; matching tasks and meetings; matching notes (opens the note).
  - Picking an out-of-range result switches to Quarter and scrolls there.

  **Lanes:**
  - **Meetings** (time zoom): blocks from start to end, colour by `kindOf`:
    - `focus`: tags focus, deep, deepwork, study, or text starting with "focus"
    - `personal`: tags personal, gym, family, health, home
    - `meet`: everything else

    Past meetings are dimmed. Overlaps stack into at most 3 rows (`stack`).
  - **Tasks** (time zoom): a card pinned left of its due moment with a checkbox toggle.
    - Untimed deadlines (saved as 23:59) are drawn at 22:00 (`dueMomentOf`).
    - "Hot" if due within 3 h.
    - Due text: "due 5 pm", "due today", "due Thu 5 pm", "done 4 pm".
  - **Notes**: notes placed at `createdAt`, linking to the note; meta "written <time>" / "edited <time or day>".
  - **Peblo lane** (time zooms):
    - A **meeting brief card** for the next meeting if it starts within 36 h, with states: offer "Brief me", loading, result count "N points from M notes", error with retry, or "Set up AI first" when no model is ready.
    - **Promise cards** ("<Owner> promised: …, by <day time>. From <note>.") with **Add to river** and **Dismiss**.
    - Cards are pushed right so they don't overlap.
    - An empty hint when there is nothing to show.

  **Week and Quarter** show chips per bin ("+N more" switches to Day zoom; notes "+more" goes to `/notes`). Clicking a bin header opens that day in Day zoom.

  **Other features:**
  - Bands for past, night and today.
  - NOW line and pill, refreshed every 30 s.
  - Drag to pan; the vertical wheel scrolls horizontally.
  - **Double-click an empty spot on the Meetings or Tasks lane** (time zooms) → inline **QuickAdd** at that time, rounded to 15 min (`timeAt`). Meetings get a 1 h length.
  - **"No date · N"** popover lists undated open tasks (first 8) with Today / Tomorrow buttons, which set the deadline to 23:59.
  - Toast messages.
  - Other screens can select an item with `navigate('/', { state: { select: id } })`.

  **Default selection:** the next meeting or task.

  **API:** `GET /todos/range?from&to`, `GET /todos?completed=false`, `GET /notes?sort=updated`, `GET /river/promises`, `GET /ai/hub/models`, `POST /river/brief`, `PATCH /todos/:id`, `POST /todos`, `PATCH /river/promises/:id`.

- **RiverDrawer** (under the river)
  - Left column:
    - pill: "Selected · happening now / in 20 min / earlier today", "Task · overdue 2 h", "due in 3 h", "done", "no date"
    - title, time range or due line with priority, tags
    - meetings: **Take notes in this meeting** (opens `/notes?new=1&forTask=<id>&forTaskText=...&tag=...`; `useNoteDoc` links the task to the note on its first save) or **Open meeting notes**
    - tasks: **Mark done / Not done yet**
    - **Move** popover: date and time pickers (start and end for meetings). For tasks it also has **No date**, which clears `deadline`, `startTime` and `endTime`.
  - Middle column:
    - meeting → **Peblo's brief** (bullet points with `[Note title]` citation links; shares the React Query cache key `['river','brief',id]` with the home card)
    - task with a linked note → snippet of that note
    - other task → "Notes that mention it" (`POST /ai/hub/search {query: task text}`, top 3 notes)
  - Right column: **On the river near it**, the 4 closest meetings, tasks or notes within ±36 h.
- **RiverNotes (`/notes[/:id]`)**: uses `useNoteDoc`.
  - **Note view:**
    - header "Back to the river" and "Monday 6 Oct · written 9 am · edited 11 am"
    - **day strip**: that day's meetings and tasks, "This note", and "Now", trimmed to the 6 closest to the note; clicking one opens the river with it selected
    - editor with tags
    - ··· menu: Restore, Archive/Unarchive, Export Markdown, Trash / Delete forever
    - side card **Promises**: "Find promises" / "Look again" (`POST /river/notes/:id/promises`) lists each promise with owner and due; actions **Put on river · <day>** (creates a todo linked to the note, due at the promise's date or **tomorrow 09:00**, text suffixed "(Owner)" when the owner is not "you"; then PATCH status `added` with `todoId`) or **Ignore** (status `ignored`)
    - side card **Used in**: linked meetings and tasks (`GET /todos?noteId=`)
  - **List view:**
    - two views (stored in `localStorage['peblo-river-notes-view']`): **Recently edited** ("Pick up where you left off" 4 cards, then month groups) and **By day written** (day groups by `createdAt`)
    - filters: All, top 10 tags, Archive, Trash
    - ranked full-text **search** across all notes (Archive and Trash search only themselves). Scoring per word: title starts with it = 4, title contains = 3, tag = 2, body = 1, and every word must match. Matches are highlighted with `<mark>` and a snippet around the hit.
- **RiverCapture** (overlay and window)
  - Meeting, Task or Note mode (Tab / Shift+Tab cycle, Esc closes).
  - `readLine` = `parseTimes` (`3pm`, `at 9:30`, `5-6pm`, `11 am–1 pm`, `17:00`; the default end is +1 h) plus `parseTask`. A time with no day means **today**.
  - A meeting **requires a time**.
  - A task with only a day is saved at 23:59; with a time, at that time.
  - A note is saved with tag `inbox` (title is the first line).
  - Live label "Meeting Tomorrow, 3–4 pm · #work".
  - Supports `preset.mode`, `preset.text` and `preset.at`, but nothing ever passes them (see the bugs section).
- **RiverAI / RiverConnections**: the shared `HubScreen` and `ConnectionsScreen` with class prefix `r-`, inside a `RiverHeader`. Starters: "What is on my plate today?", "Brief me for my next meeting", "What did I promise people this week?", "Plan my afternoon around my meetings".

**Utility logic (`riverUtils.js`).**
- **Timeline maths:** `xOf` (piecewise-linear position: awake hours to scale, night compressed, pre-08:00 moments drawn in the previous night band; bins use day fraction), `rangeStart`, `rangeWidth`, `mondayOf`, `timeAt` (in RiverHome, the inverse of `xOf`, 15-min snap).
- **Item times:** `momentOf` (deadline + startTime), `endOf` (via `spanOf`), `dueMomentOf` (23:59 → 22:00), `isAllDay`.
- **Labels:** `clock` ("5:30 pm"), `clockRange`, `dayWord` (Today, Tomorrow, Yesterday, weekday within 6 days, otherwise "12 Oct"), `fromNow`.
- **Layout and parsing:** `stack` (greedy interval row packing), `kindOf`, `parseTimes`, `tagsOfTask`, `initialsOf`.

**localStorage keys.** `peblo-river-zoom`, `peblo-river-notes-view`.

---

### 2.3 Orbit (`client/src/orbit/`)

**Concept.** "A map of what you know, built for studying." Tags are topics. A dotted canvas map is always behind the UI: a centre node (your map, or a "space" = a tag), topic circles on an ellipse sized by note count and **ringed by mastery** (weak < 50, ok < 80, strong ≥ 80, none = never quizzed), plus "leaf" chips for a few notes and tasks per topic. Notes, Quiz and Due open as **sheets over the map**; Ask and Your AI cover it.

**Shell (`OrbitShell.jsx`).**
- **Shared data** through `OrbitContext`: `GET /notes?sort=updated` (`['notes','sidebar']`), `GET /todos` (`['todos','orbit-all']`), `GET /study/mastery` (`['study','mastery']`).
- **Top bar:**
  - brand
  - **space picker**: "Whole map" plus the top 14 tags with mastery-coloured dots, and a breadcrumb
  - nav pills: Map (`/`), Notes, Due (`/tasks`), Ask (`/ai`)
  - **"Ask the map"** box, focused with `/`. It shows the WEAKEST topic when the query matches `/weak|revise|worst|study first/`, matching TOPICs and NOTEs, and always an "Ask Peblo: …" entry (→ `/ai?q=`). Enter picks the first result.
  - "+" capture (preset tag = current space)
  - avatar menu: Your AI and privacy, **This week** (`/calendar`), theme, Settings
- **Space state:** `localStorage['peblo-orbit-space']`. When it is `undefined`, the first visit auto-picks the "main subject" with `pickSubject`: the first tag (by count) whose notes share at least 2 other tags. If the saved space's tag no longer exists, it falls back to the whole map.
- **Revision-path toggle:** `localStorage['peblo-orbit-path']` (default true).
- **Selection** (`selected`: `'center'`, `t-<tag>` or `n-<noteId>`) lives in context only.
- The map is rendered on every route except `/ai*` and is interactive only on `/`.

**OrbitMap (the map).**
- **Graph** (`orbitUtils.buildGraph`):
  - **Whole map**: centre = "<Name>'s map · N NOTES"; satellites = the top 7 tags.
  - **In a space**: centre = the topic name, and its meta is the next exam (a task whose text matches `/exam|test|viva|mid-?sem|finals?/` tagged with the space) or the next deadline, else the note count. Satellites = the top 7 co-occurring tags. If fewer than 2 co-tags exist, it switches to **note mode** and the 7 most recent notes become satellites.
  - Each topic carries open tasks (by tag), its score and level, and leaves (1–2 recent notes, plus 1 task).
  - `center.ready` = average score of the quizzed topics.
- **Layout** (`layoutGraph`):
  - topics on an ellipse starting at −140°, node diameter 84 + 6·min(count, 8)
  - leaves pushed outward (fan ±0.62 rad, ×1.25 horizontal stretch)
  - up to **60 iterations of overlap relaxation**: leaf against leaf, and leaf against circle using the nearest point on the box, with an extra 30 px below a circle for its label; clamped to the map area while avoiding the left tools and the right card
- **Revision path** (`revisionPath`):
  - up to 3 quizzed topics scoring < 80, weakest first
  - if *no* topic has been quizzed, the biggest topics instead
  - estimated minutes: 35 for weak or unquizzed, 20 for ok
  - drawn as a dashed curved route with numbered step badges
  - the bottom bar shows "Revision path · <exam day> · about N min", the steps, and **Start · 35/20 min**, which starts a quiz on step 1
- **Interaction:**
  - pan by drag; wheel zoom 0.55–1.8× around the cursor; zoom +/−/reset buttons
  - clicking empty map selects the centre
  - clicking a topic selects it; double-click opens it as its own space
  - clicking a note node or leaf opens the note; a task leaf goes to `/tasks`
  - task leaves are "hot" when overdue
- **Tools rail:**
  - Select
  - **New note here** (`/notes?new=1&tag=<space,selected>`)
  - **New task here** (opens capture in task mode with the tag)
  - **Put a note on this topic**: search notes not yet on the tag, then `PATCH /notes/:id {tags:[...tags, tag]}`
  - **New topic**: typed name is slugged and starts a note with that tag
- **Selected card** (right side):
  - **Topic**:
    - eyebrow with counts
    - "Open as its own map"
    - mastery bar "N% mastered · weak / getting there / strong", "quizzed <ago>"
    - **"Peblo noticed"**: last quiz missed X of Y, mostly on <concept1> and <concept2>; or "all right last time…"; or "not quizzed yet, N questions…"
    - 2–3 recent notes and 1 task
    - **Quiz this · 10 Q**, **Open notes** (`/notes?topic=<tag>`)
  - **Space or whole map**: readiness, a noticed text about the exam and weakest topic, the next 3 dated tasks, **Quiz <weakest>** or "See what's due", **New note**, and a tip in note mode.
- **"Your whole map"** mini panel: the top 5 tags as dots (click to open or close the space) and a ring legend.
- An empty state when there are no tags.

**OrbitNotes (`/notes[/:id]`).** A sheet over the map using `useNoteDoc`. Clicking the scrim force-saves and returns to `/`.
- **Note:**
  - breadcrumb: space, then the first topic with its mastery dot
  - status "EDITED 3 PM · SAVED"
  - ··· menu: Restore, Archive/Unarchive, Export, Trash
  - "NOTE · WRITTEN WED 7 OCT"
  - title, topic chips (mastery-coloured), "+ topic", editor
  - Rail:
    - **Connected to**: topic chips (click to select that topic on the map) and linked tasks (`GET /todos?noteId=`)
    - **Peblo suggests a link**:
      1. take a related note from `POST /ai/hub/search {query: title + 160-char snippet}`; if it has a tag this note lacks, offer to add that tag (**Link**)
      2. an open, unlinked task sharing a word of 5+ letters with the note → **Attach** (`PATCH /todos/:id {noteId}`)
      3. "Not now" dismisses for the session
    - **Quiz bank count**: "N Q in your quiz bank come from this note" (`GET /study/notes/:id/questions`)
- **List:**
  - "Every note", or a topic from `?topic=`
  - Archive and Trash chips
  - search over title and content (client-side)
  - **notes grouped under their most specific topic** (the tag the fewest notes share), with an "All notes" reset
  - New note, preset with the topic or space

**OrbitQuiz (`/quiz/:topic`).** A sheet.
- On mount it calls `POST /study/quiz {topic, count:10}` (client timeout 5 min).
- Loading text: "Writing 10 questions from your N notes on <Topic>…"; an error state offers Try again / Check Your AI.
- Per question:
  - "QUESTION i OF n · <concept>"
  - progress dots (now, right, wrong)
  - options A–D; **keys 1–4 answer, Enter goes on**
  - feedback "Right." / "Not quite. It's B." plus the explanation and a "From your note: <title>" link
- Finishing posts `POST /study/quiz/:id/answers {answers}`.
- Result screen: `correct/total`, pct, the new mastery bar "was X%", **What to look at again** (missed concepts with counts), Back to the map / Another quiz / Open its notes.
- It then invalidates `['study']`.

**OrbitDue (`/tasks` list, `/calendar` week).** A sheet with a List/Week toggle.
- Add bar uses `parseTask` and auto-adds the current space tag. A parsed date is saved at 23:59.
- **List groups:**
  - Overdue (open only)
  - each of the next 21 days (Today, Tomorrow, "Wed 9 Oct")
  - Later (21 days or more)
  - No date (open only)
  - Completed tasks with a future or today deadline still show (struck through).
  - Each row: checkbox, first-tag chip with its mastery colour, time, delete with confirm.
- **Week:** Monday-start columns, prev / This week / next; clicking an item toggles it done.
- API: `POST /todos`, `PATCH /todos/:id`, `DELETE /todos/:id`. The list comes from the shell's `GET /todos`.

**OrbitCapture.**
- Note or Task (Tab switches), with a topic chip preset from the space or tool (removable).
- Task: `parseTask`, date at 23:59, tags = topic plus `#tags`.
- Note: the whole line with `#tags` stripped becomes the **title**; content is empty; tags = topic plus the line's tags, or `['inbox']`.
- Status: "On the map in <Topic>".

**OrbitAI / OrbitConnections.** `HubScreen` and `ConnectionsScreen` with prefix `o-`. Starters: "Quiz me on my weakest topic", "What should I revise before my exam?", "Explain my latest note simply", "Make flashcards from my notes this week". These are chat prompts; they do not start a real quiz.

**Utility logic (`orbitUtils.js`).**
- `topicName`: "sql-joins" → "SQL joins"; words of 3 or fewer letters, or with no vowel, are uppercased.
- `levelOf`, `LEVEL_LABEL`, `levelVar`.
- `HIDDEN_TAGS` = {inbox, private}; `tagsOfNote` drops them.
- `tagCounts`, `pickSubject`, `buildGraph`, `layoutGraph`, `revisionPath`, `minutesText`, `agoText`, `shortDate`.
- Orbit also imports `dayWord`, `clock`, `momentOf`, `mondayOf`, `isAllDay`, `initialsOf` from `riverUtils`.

**Spaced repetition.** There is **no** spaced-repetition scheduler (no intervals, due dates or review queue). "Mastery" is an exponential moving average per topic, computed on the server (§3.2). "One more quiz in a few days" is copy only.

**localStorage keys.** `peblo-orbit-space` (JSON: a tag or `null`), `peblo-orbit-path` (JSON boolean).

---

## 3. Server routes

Both routers are mounted in `server/src/index.ts:69-70` as `/api/study` and `/api/river`, and both apply `authenticate` to every route.

### 3.1 `server/src/routes/river.ts`

Helpers:
- `isPrivate(n)`: the note has the tag `private`.
- `parse`: JSON parse with a fallback.
- `promiseView(gen, noteTitle)` → `{id, noteId, noteTitle, createdAt, items}`.

Promises are stored in **`ai_generations`** (`AiGeneration` model: `noteId`, `userId`, `type='promises'`, `result` LongText JSON `{items:[{text, owner, due, status, todoId}]}`). Every "Find promises" run creates a **new row**.

| Method | Path | Request | Response | DB | Logic |
|---|---|---|---|---|---|
| POST | `/api/river/brief` | `{ todoId }` | `{ points:[{text, cite:number[]}], sources:[{n,id,title}] }`; 404 `{error:'Meeting not found'}` | `todos` read; retrieval reads notes (and embeddings) | Loads the user's todo. Calls `retrieve(userId, text + todoTags, {maxNotes:5})` and keeps sources of kind `note`, numbered 1..n. If there are none → `{points:[],sources:[]}`. `when` = `deadline.toDateString()` + startTime (server timezone). `meetingBrief` (aiService: 3–5 points, each citing up to 3 notes) builds the result; citations are filtered to 1..n. Private exclusion relies on `retrieve`. |
| POST | `/api/river/notes/:id/promises` | none | `{id, noteId, noteTitle, createdAt, items}`; for content under 20 chars `{id:null, noteId, items:[]}`; 400 for #private; 404 | `notes` + `note_tags/tags` read; **`ai_generations` insert** | `findPromises(userId, title, content, createdAt)` returns at most 6 `{text ≤160, owner ≤40 (default "you"), due ISO or null}`. Each item gets `status:'open', todoId:null` and is stored as a new generation. |
| GET | `/api/river/promises[?noteId=]` | query `noteId` (optional) | `{promises:[promiseView...]}` | `ai_generations` read + `notes` (title, isDeleted) | With `noteId`: all generations for that note. Without: generations from the **last 30 days**. Ordered newest first; keeps only the **latest generation per note** and skips deleted notes. The comment says "open ones, unless a note is asked for", but the server returns all items; the client filters to `status==='open'`. |
| PATCH | `/api/river/promises/:id` | `{ index, status: 'added'|'ignored'|'open', todoId? }` | `promiseView(saved)` (without `noteTitle`) | `ai_generations` read + update | Checks ownership and `type`. 400 if `items[index]` is missing or the status is invalid. Sets status and `todoId` (keeps the old one if none is given). Read-modify-write of the JSON blob. |

### 3.2 `server/src/routes/study.ts`

Helpers:
- `clean(t)`: trim, strip a leading `#`, lowercase, max 60 chars.
- `parse`.
- `shape(m)` → `{topic, score, quizzes, lastCorrect, lastTotal, missed:[{concept,n}], updatedAt}`.

Tables:
- **`quiz_runs`** (`QuizRun`: id, userId, topic, questions LongText, answers?, correct?, total, createdAt, finishedAt?)
- **`topic_mastery`** (`TopicMastery`: primary key (userId, topic), score Int, quizzes, lastCorrect, lastTotal, missed LongText, updatedAt)

| Method | Path | Request | Response | DB | Logic |
|---|---|---|---|---|---|
| GET | `/api/study/mastery` | none | `{mastery:[shape...]}` | `topic_mastery` read | Every quizzed topic for the user. |
| POST | `/api/study/quiz` | `{ topic, count? }` | `{id, topic, questions:[{q, options[2..4], answer, explain, concept, noteId, noteTitle}], fromNotes}`; 400 for no topic / nothing to quiz; 502 for no questions | `notes` + tags read; **`quiz_runs` insert** | Count clamped to 3–15 (default 10). Takes the 12 most recently updated non-deleted notes with that tag, then drops #private notes and content of 40 chars or fewer. Error messages explain which case applied. `makeQuiz` sends at most 2,500 chars per note and 12,000 total; asks for exactly 4 options; validates and fixes `answer` (default 0) and `note` (1..n or null); max `count` questions. `note` is mapped to `noteId` and `noteTitle`; the run is stored with the answers. **The response includes `answer` and `explain`**, so the client marks answers locally. |
| POST | `/api/study/quiz/:id/answers` | `{ answers:number[] }` (non-integers → −1) | `{correct, total, pct, mastery: shape}` | `quiz_runs` read + update (answers, correct, finishedAt); `topic_mastery` upsert | Scores against the stored answers and counts missed concepts. **Mastery** = `round(prev*0.4 + pct*0.6)`, or `pct` on the first quiz; `quizzes += 1`; `lastCorrect` and `lastTotal` set; `missed` **replaced** by this run's missed concepts sorted by count. |
| GET | `/api/study/notes/:id/questions` | none | `{count}` | `quiz_runs` read (all of the user's runs) | Parses every run's questions and counts those whose `noteId` matches. |

---

## 4. Feature parity (feature × style)

Studio and Console share the same page components (`HomePage`, `WorkspacePage`, `TasksPage`, `CalendarPage`, `AIHubPage`, `ConnectionsPage`). Those pages were outside this scope, so "?" means not verified; "shared" means whatever those pages do. Neither of them calls `studyAPI` or `riverAPI`: a grep shows those APIs are used only under `orbit/` and `river/`.

| Feature | Studio | Console | Soft | River | Orbit |
|---|---|---|---|---|---|
| Frame | Sidebar (collapsible) | Icon rail + command bar + status bar | Header + floating dock | Top header, no Tasks/Calendar nav | Floating pill top bar over the map |
| Command palette (Ctrl+K) | yes (button) | yes (button and empty command) | yes (search pill) | yes (hotkey only) | yes (hotkey only) |
| Inline "ask" box → `/ai?q=` | via palette | command bar | Home ask box | — (Jump box is local search) | "Ask the map" box (+ weakest-topic shortcut) |
| Recent notes / tag list in chrome | yes | — | — | — | space picker = top 14 tags |
| Status counts (notes, open tasks, model) | trust box | status bar + pill | Home streak tile shows AI line | — | — |
| Home dashboard | HomePage (shared) | shared | tiles: today, coming up, notes, streak | timeline | knowledge map |
| Notes: editor, tags, archive, trash, export | shared | shared | yes (own implementation) | yes (`useNoteDoc`) | yes (`useNoteDoc`) |
| Notes: version history / restore backup | ? | ? | **yes** | no | no |
| Notes: preview (read-only) toggle | ? | ? | **yes** | no | no |
| Notes: selection pill (Explain, Make task, Quiz) | ? | ? | **yes** | no | no |
| Notes: "Ask about this note" panel | ? (Ctrl+J toggles "Ask AI panel" per AppShell comment) | ? | **yes** | no | no |
| Notes: "Mentioned in" backlinks | ? | ? | **yes** (title substring) | no | no |
| Notes: related-note / attach-task suggestions | ? | ? | no | no | **yes** (hub search) |
| Notes: day strip (what happened that day) | — | — | — | **yes** | — |
| Notes: find promises → tasks | — | — | — | **yes** | — |
| Notes: "Used in" linked meetings/tasks | ? | ? | linked tasks only | **yes** | linked tasks ("Connected to") |
| Notes list: ranked full-text search + highlight | ? | ? | no search | **yes** | simple substring |
| Notes list grouping | ? | ? | flat list | recent / month or by day written | by most-specific topic |
| Tasks: board (Today, Tomorrow, Week, Done) | ? | ? | **yes** | — | — |
| Tasks: list grouped by day | ? | ? | list view | — (timeline) | **yes** (21 days) |
| Tasks: natural-language add (`parseTask`) | ? | ? | yes (deadline **17:00**) | yes, + times via `parseTimes` (23:59 or exact time) | yes (23:59) |
| Tasks: delete | ? | ? | yes | **no** (no delete anywhere in River) | yes |
| Tasks: edit date/time (Move) | ? | ? | no | **yes** (drawer Move, clear date) | no |
| Tasks: schedule undated quickly | ? | ? | no | **yes** (Today/Tomorrow popover) | no |
| Meetings (todo + startTime) as first-class | — | — | shown as timed events | **yes** (lane, kind colours, notes per meeting) | week view marks `.meet` |
| Calendar views | CalendarPage | shared | Day / Week (Sun-start) / Month + mini month + countdown | Hours / Day / Week / Quarter timeline | Week (Mon-start) |
| Create items by clicking the calendar | ? | ? | no | **yes** (double-click lane) | no |
| AI meeting brief | — | — | — | **yes** (`/river/brief`) | — |
| Quizzes from notes + mastery score | — | — | prompt chip to chat only | — | **yes** (`/study/*`) |
| Revision path / weakest topic | — | — | — | — | **yes** |
| Topic map with pan/zoom | — | — | — | — | **yes** |
| Quick capture overlay in-app | `/tasks?add=1` link (Console) | same | yes (task/note, link-note suggestion, duplicate warning) | yes (meeting/task/note) | yes (note/task on topic) |
| Capture window (Ctrl+Shift+Space) | generic | generic | SoftCapture | RiverCapture | OrbitCapture |
| AI Hub UI | AIHubPage | shared | own 3-pane `SoftAI` | `HubScreen p="r"` | `HubScreen p="o"` |
| Your AI routing choices | ConnectionsPage | shared | 3 (ollama / ask / auto) | 3 (ConnectionsScreen) | 3 |
| Theme cycle in chrome | yes | yes | yes | avatar menu | avatar menu |
| Style-specific localStorage | `peblo-sidebar-collapsed` | — | — | `peblo-river-zoom`, `peblo-river-notes-view` | `peblo-orbit-space`, `peblo-orbit-path` |
| `/quiz/:topic` route | redirect home | redirect home | redirect home | redirect home | quiz |

---

## 5. Bugs, risks, dead code and inconsistencies

Labels:
- **[Bug]**: will misbehave in normal use.
- **[Risk]**: edge case, robustness or security.
- **[Dead]**: unused code.
- **[Inconsistency]**: behaviour that differs between styles, or copy that does not match behaviour.

### Orbit
1. **[Bug] Quiz result shows the new score as "was X%"** (`orbit/OrbitQuiz.jsx:29`, `:63`, `:87`, `:157`).
   - `before` is recomputed from the live `mastery` context on every render.
   - After `answer()` the code invalidates `['study']`; mastery refetches and `before` becomes the *new* score.
   - So the result card shows "was <new>%", and the header shows "<new>% MASTERED BEFORE".
   - Fix direction: capture `before` when the quiz starts.
2. **[Bug] Answers can be submitted more than once, and each submission moves mastery again** (client `orbit/OrbitQuiz.jsx:59-64`, `:67-75`; server `server/src/routes/study.ts:77-108`).
   - `next()` on the last question has no in-flight guard. Pressing Enter (the global key handler) or clicking repeatedly before `result` arrives sends several POSTs.
   - The server never checks `run.finishedAt`. Each POST re-applies the 0.4/0.6 average and increments `quizzes`.
   - Any client can also replay `/quiz/:id/answers` to push a score.
3. **[Bug] Unquizzed topics drop out of the revision path once any topic has been quizzed** (`orbit/orbitUtils.js:202-203`).
   - Steps are "quizzed and score < 80". Topics never quizzed are only used when *no* topic has been quizzed.
   - With one strong quizzed topic plus several unquizzed ones, the path says "Nothing weak right now / Every topic here is strong".
4. **[Bug] Keys 1–4 can pick an option that does not exist** (`orbit/OrbitQuiz.jsx:70`). `makeQuiz` allows 2–4 options (`aiService.ts:1102-1105`). On a 3-option question, key "4" records answer index 3. It is marked wrong and no option is highlighted.
5. **[Bug] Orbit tasks have no error handling.** `todosAPI` calls in `OrbitDue.jsx:27-48`, `OrbitMap.jsx:130-135` (connect) and `OrbitNotes.jsx:100-107` (accept) have no try/catch.
   - Failures become unhandled promise rejections.
   - The optimistic toggle in `OrbitDue.jsx:28` is never rolled back.
   - `OrbitQuiz.jsx:61` (`answer`) likewise has none, so the user is left on the last question with no message.
6. **[Inconsistency] Leaf width is estimated from a hard-coded "· due Tomorrow"** (`orbit/orbitUtils.js:139`). The rendered text uses `dayWord(deadline)` (`OrbitMap.jsx:179`), so the overlap layout uses the wrong widths.
7. **[Bug] `topicName` uppercases every word of 3 or fewer letters** (`orbit/orbitUtils.js:14`). "theory-of-computation" → "Theory OF computation" and "web-dev" → "WEB DEV". The rule is meant for acronyms but catches ordinary short words.
8. **[Inconsistency] Quiz size copy disagrees with itself.**
   - The card says "Quiz this · 10 Q" (`OrbitMap.jsx:379`).
   - "Peblo noticed" promises `min(10, max(3, count*2))` questions (`OrbitMap.jsx:343`).
   - The loader says "Writing 10 questions" (`OrbitQuiz.jsx:95`).
   - The client always requests 10 (`OrbitQuiz.jsx:40`), and the server may return fewer.
9. **[Inconsistency] Space picker label never changes** (`orbit/OrbitShell.jsx:112`). The button always reads "Whole map" even inside a space; only the breadcrumb next to it changes.
10. **[Risk] Double URL decoding** (`orbit/OrbitQuiz.jsx:17`). `decodeURIComponent(useParams().topic)`: React Router has already decoded the param, so a tag containing `%` throws a `URIError` and crashes the screen.
11. **[Risk] Performance: the map is always mounted** (`orbit/OrbitShell.jsx:225`). `OrbitMap` (graph build, a 60-iteration O(n²) layout, a ResizeObserver) is mounted behind every Orbit screen except `/ai*`, including note editing, where each autosave invalidation rebuilds the graph.
12. **[Risk] Quiz bank count is a full scan** (`server/src/routes/study.ts:112-121`). `GET /study/notes/:id/questions` loads and JSON-parses **every** quiz run for the user on every note open. It also counts unfinished runs and repeats from the same question set.
13. **[Inconsistency] Mastery "missed" is overwritten each quiz** (`study.ts:99-103`). "Peblo noticed" reflects only the last run. Topic mastery rows are never cleaned up when a tag is renamed or removed.
14. **[Inconsistency] Ask starters imply features that are not wired** (`orbit/OrbitAI.jsx:5-10`; same for Soft chips in `SoftHome.jsx:114` and `SoftNotes.jsx:213`, `:364`). "Quiz me on my weakest topic" and "Make flashcards…" go to the generic chat, not to `/quiz` or `/study`. River's "What did I promise people this week?" (`river/RiverAI.jsx:7`) likewise has no access to the promises stored in `ai_generations` unless the hub retrieval reads them, which was not verified.
15. **[Dead] Unused Orbit CSS selectors.**
    - `.orbit .mono` (`orbit.css:96`)
    - `.o-node .ball.hit` (`:164`)
    - `.o-leaf.done` (`:187`; leaves only ever hold open todos)
    - `.o-btn.o-welcome-btn` (`:471`)
    - `.o-toast` (`:518`)

### River
16. **[Bug] Moving an all-day task silently makes it timed at 10 pm** (`river/RiverDrawer.jsx:38`, `:202-216`).
    - For an untimed task (23:59), `at = dueMomentOf()` returns **22:00**, so the Move form pre-fills 22:00.
    - Saving writes a deadline at 22:00. The task is no longer `isAllDay`, and Soft and Orbit then show a "22:00" time.
17. **[Bug] "Look again" duplicates promises already added** (`river/RiverNotes.jsx:91-104`; `server/src/routes/river.ts:58-61`, `:78-79`).
    - Each run inserts a fresh generation with every item `open`, and GET keeps only the latest generation per note.
    - Promises already "added" or "ignored" come back as open. Adding them again creates duplicate todos.
18. **[Bug] Jump scrolls to the wrong place after a zoom change** (`river/RiverHome.jsx:255-258`). `pick()` calls `setZoomSaved('quarter')`, then a `setTimeout` that uses the `scrollTo` closure from the *previous* render (old zoom and scale). The `useLayoutEffect([zoom])` at `:150` also resets the scroll to now, so the scroll position is wrong. The same pattern appears in the bin-header and "+N more" handlers (`:459`, `:501`, `:543`).
19. **[Bug] Overflow items vanish silently in time zooms** (`river/RiverHome.jsx:471`, `:511`, `:553`). Rows are capped at 3 and items with `row >= 3` are filtered out with no "+N more". On a busy day meetings, tasks or notes just disappear.
20. **[Bug] Promise "+N more" does nothing** (`river/RiverHome.jsx:617-629`). The Peblo-lane `BinChips` for promises are rendered without `onMore`, so the button's `onClick` is undefined. Also, in Week and Quarter, clicking a promise chip **immediately adds it**; there is no dismiss.
21. **[Inconsistency] Data range and drawn width disagree** (`river/RiverHome.jsx:64` vs `river/riverUtils.js:59-63`).
    - `end = start + back + ahead + 7` days, used for fetching and for tick and night generation.
    - `rangeWidth` uses `back + ahead + 1` days for non-week zooms.
    - In Hours and Day zoom, 6 extra days of ticks, night bands and items are positioned beyond the track's `width`.
22. **[Bug] Meetings near midnight get a bad end time.**
    - QuickAdd at 23:xx sets `endTime` to 00:xx (`river/RiverHome.jsx:693-698`).
    - `parseTimes` caps the default end at 23 (`riverUtils.js:198`), so 23:30 gives a 23:30–23:30 zero-length meeting.
    - `spanOf` then forces +1 h past midnight on the same day.
23. **[Risk] River actions have no error handling.** These calls have no try/catch:
    - `RiverHome.jsx:183-187` (toggle; the optimistic update is never rolled back)
    - `RiverHome.jsx:197-217` (promises and scheduling)
    - `RiverHome.jsx:689-701` (QuickAdd: `busy` stays true on failure)
    - `RiverDrawer.jsx:208-223` (MoveForm: `busy` stays true)
    - `RiverNotes.jsx:105-118`

    `addPromise` and `putOnRiver` create the todo and then PATCH the promise. If the PATCH fails, the promise stays open and can be added again, creating a duplicate.
24. **[Risk] Lost updates on promise status** (`server/src/routes/river.ts:88-102`). PATCH does a non-atomic read-modify-write of one JSON blob. Two quick clicks on different items of the same generation (Add then Dismiss) can lose one update.
25. **[Risk] `todoId` is not checked** (`river.ts:96`). The id is stored as given, without verifying it belongs to the user. It is only stored, not dereferenced, so the impact is low.
26. **[Inconsistency] Brief date uses the server timezone** (`river.ts:30`). `todo.deadline.toDateString()` can give the wrong date in the prompt for users in other timezones.
27. **[Dead] The capture preset is never used** (`river/RiverCapture.jsx:41-42`, `:57`, `:298-305`). `preset.mode`, `preset.text` and `preset.at` are supported, and the header comment says it opens "from a double-click on the river (with the time filled in)". But River dispatches a plain `Event('peblo:capture')` with no `detail` (`RiverShell.jsx:51`), and double-click uses the separate inline `QuickAdd`.
28. **[Dead] Note body capture is unreachable** (`river/RiverCapture.jsx:102`; same in `soft/SoftCapture.jsx:86`). `raw.split('\n')` puts the rest of the text into the note body, but the field is a single-line `<input>`, so content is always empty.
29. **[Inconsistency] Calendar zoom handling** (`river/RiverHome.jsx:50-52`, `:72`).
    - `/calendar` forces Week zoom via an effect after the first render, so the saved zoom renders first and then flips.
    - `/tasks` (initialZoom `day`) ignores its own "day" and uses the saved zoom.
    - So "Tasks" in River just means "the river".
30. **[Inconsistency] No task delete in River.** No River screen can delete a todo; you must switch style or use another surface.
31. **[Dead] Unused CSS selector** `.r-ok` (`river.css:594`).

### Soft
32. **[Inconsistency] Tasks created in Soft are due at 17:00 instead of all-day.**
    - `parseTask` sets dated deadlines to **17:00** (`utils/parseTask.js` `at()`).
    - Soft saves this as-is (`soft/SoftTasks.jsx:65`, `soft/SoftCapture.jsx:81`).
    - Orbit and River reset it to **23:59** (all-day) (`OrbitDue.jsx:43`, `OrbitCapture.jsx:49`, `RiverCapture.jsx:108`).

    The same input "revise BCNF tomorrow" is a 5 pm timed task in Soft but an all-day task elsewhere. Soft tasks then show as "due 5 pm" on River and appear hot within 3 h. A "today" task made after 5 pm is overdue immediately.
33. **[Risk] Soft actions have no error handling.**
    - `SoftHome.jsx:86-91` and `SoftTasks.jsx:47-57`: toggle and delete have no try/catch, and the optimistic update is never rolled back.
    - `SoftTasks.jsx:60-72` uses try/finally without catch, so a failed add shows no message.
    - `SoftNotes.jsx:129-165`, `:203-214`: archive, trash, revert and pill actions have no try/catch.
34. **[Risk] Duplicated note logic** (`soft/SoftNotes.jsx:14-165`). SoftNotes reimplements note loading, draft and autosave and does not use `hooks/useNoteDoc.js`. The duplication has already diverged:
    - Soft ignores `?forTask=` (River's "Take notes" linkage) and `?topic=`.
    - Soft auto-opens the first note on `/notes` (`:87-89`), even right after archiving or trashing, possibly with the stale cached list.
35. **[Inconsistency] Week start differs.** SoftCalendar weeks start on Sunday (`soft/SoftCalendar.jsx:16`); Orbit and River use Monday (`mondayOf`).
36. **[Inconsistency] Only 3 routing options** (`soft/SoftConnections.jsx:7-11`; shared `ConnectionsScreen.jsx:8-10`). The Studio sidebar knows 5 routings (`Sidebar.jsx:11`: `openai`, `gemini` also). A user with `openai` or `gemini` routing sees no radio selected in Soft, River or Orbit.
37. **[Dead] Unused CSS selector** `.soft .s-display` (`soft.css:219`).

### Shell and cross-style
38. **[Inconsistency] Two different "Ollama not running" rules.**
    - `Sidebar.jsx:54-56` shows "Ollama not running" only when routing is `ollama`.
    - `useShellData.js:30-32` shows it whenever local AI is enabled and down.
    - The same logic is copy-pasted (`Sidebar.jsx:22-37` duplicates `useShellData`'s three queries), and the two copies already differ.
39. **[Inconsistency] Stale comment** (`context/AuthContext.jsx:18`). It lists only three styles ("studio, console or soft"); river and orbit are missing.
40. **[Risk] Style is not part of the account** (`AuthContext.jsx:19-21`, `:169-172`). It lives only in `localStorage`, unlike settings, so it does not follow the user across devices.
41. **[Risk] The capture window may not follow a style change.** The separate Ctrl+Shift+Space window reads `uiStyle` once at mount. It is not updated when the style changes in the main window, because there is no storage-event listener.
42. **[Risk] Ctrl+J does nothing inside a note in three styles** (`AppShell.jsx:37`). AppShell skips Ctrl+J on `/notes/:id` "where it toggles that note's Ask AI panel instead". Soft, River and Orbit note screens have no such hotkey handler (this folder scope had none).
43. **[Inconsistency] Duplicated helpers.**
    - `useDismiss` is defined twice, identically (`orbit/OrbitShell.jsx:24-35`, `river/RiverShell.jsx:16-27`).
    - Styles depend on each other's util modules: Orbit imports from `river/riverUtils` and `soft/softUtils`; River imports from `soft/softUtils`. Removing or changing one style can break the others.
44. **[Inconsistency] Optimistic updates only touch one cache key each.** Orbit uses `['todos','orbit-all']`, River `['todos','range','river',...]`, Soft `['todos','all']` or `['todos','today']`. The real state arrives after `invalidateQueries`, so other views on the page briefly disagree.
