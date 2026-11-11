# Peblo: missing features and functionality

Updated 12 November 2026. Compared against Notion, Todoist, Sunsama, Akiflow, Motion, Google Calendar, Obsidian and Microsoft Loop/Teams.

How to read it: **Status** is Missing (nothing in the app) or Partial (exists but narrower than the comparison product). **Priority** is P1 (users notice within a week), P2 (clear value), P3 (nice to have). **Effort** is S (under a day), M (days), L (a week or more). Status is based on a keyword scan of the client and server code, not on exhaustive manual testing; confirm before building.

Research basis (public comparison pages, read 11 Nov 2026): morgen.so Sunsama vs Motion, dev.to Motion/Akiflow/Sunsama comparison, bullet.so Loop vs Notion, softr.io Obsidian vs Notion, plus Todoist review pages from search results. Vendor claims were not checked against vendor documentation, and the pages did not cover every feature (templates, recurring tasks and capacity warnings were not described for Sunsama or Motion).

## Fixed in this batch

- Teammates could not edit a team note written by someone else. The live-editing pass (ticket and WebSocket) only allowed the author, or Office notes shared with a person. Team members who can write now edit live, viewers read. Tests: `e2e/team-mate-edit.mjs`, `e2e/team-edit.mjs`.
- The first-run spaces tip sat on top of the space menu and blocked switching. It now hides while the menu is open.

## Notes

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Databases with table, board, calendar and timeline views over notes | Notion | Missing | P2 | L |
| Linked and synced blocks reused across notes | Notion, Loop | Missing | P3 | L |
| Web clipper (browser extension to save pages) | Notion, Obsidian | Missing | P2 | M |
| User plugins | Obsidian | Missing | P3 | L |
| Local-first Markdown files on disk, open vault | Obsidian | Partial (exports exist, storage is a database) | P3 | L |
| Template gallery with sharing | Notion | Partial (a few built-in templates) | P2 | M |
| Version history with restore | Notion, Obsidian Sync | Partial (exists) | P3 | M |
| Cross-note embeds that stay live | Loop | Missing | P3 | L |

## To-dos

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Natural-language quick add ("every Friday 4pm #work p1") | Todoist | Partial (some date parsing) | P1 | M |
| Saved filters with a query language | Todoist | Partial | P2 | M |
| Reminders as push notifications | Todoist | Partial (in-app only; no web push found) | P1 | M |
| Board (kanban) view of tasks | Todoist, Notion | Partial (a board view exists) | P2 | S |
| Task and project templates | Todoist | Missing | P2 | M |
| Unified inbox pulling from Gmail, Slack and other tools | Akiflow | Missing | P2 | L |
| Global command bar for quick capture | Akiflow | Partial (Ctrl+K palette, capture window) | P2 | S |

## Calendar

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Two-way sync with Google Calendar and Outlook | Google Calendar, Sunsama, Motion | Partial (ICS feeds in; no write back) | P1 | L |
| Event invitations, RSVP and guest lists | Google Calendar | Missing | P2 | L |
| Find-a-time across attendees | Google Calendar | Missing | P3 | L |
| Working hours and out-of-office blocks | Google Calendar, Motion | Missing | P1 | S |
| Video-call links on events | Google Calendar | Missing | P3 | M |

## Team and Office mode

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Presence and live cursors for teammates in a note | Notion, Loop | Partial (cursors exist; verify for team notes) | P1 | S |
| Comments and @mentions that notify teammates | Notion, Loop | Partial | P1 | M |
| Page-level permissions inside a team | Notion | Partial (Office has per-note sharing; Teams do not) | P2 | M |
| Single sign-on and user provisioning (SAML, SCIM) | Notion, Loop | Missing | P2 | L |
| Meeting notes that attach to a calendar event | Loop/Teams | Missing | P2 | M |
| Role change takes effect in open editors at once | all | Partial (checked on a timer, up to a minute) | P3 | S |

## Sharing

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Publish as a website with a custom domain | Obsidian Publish, Notion | Partial (share links; no custom domain) | P3 | L |
| Link password | Notion | Missing | P2 | S |
| Comment-only share level | Notion | Missing | P2 | S |

## AI

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| AI estimates for task duration | Sunsama, Akiflow | Missing | P1 | S |
| Action-item extraction from meeting notes into tasks | Notion AI, Copilot | Partial (proposals inbox exists) | P2 | M |
| AI daily summary and end-of-day recap | Sunsama AI | Missing | P2 | M |
| Workspace-wide Q&A over a team's notes | Notion AI, Copilot | Partial (Personal notes only) | P2 | M |

## Mobile

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Offline editing with sync on reconnect | Obsidian, Notion | Partial | P1 | L |
| Push notifications for reminders and mentions | all | Missing | P1 | M |
| Home-screen widgets and quick-capture share target | Todoist | Missing | P2 | M |

## Import and export

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Import from Notion, Evernote, Obsidian vault, Todoist | Notion | Partial (CSV and Markdown) | P2 | M |
| Scheduled backup to a cloud drive | Obsidian Sync | Missing | P3 | M |

## Search

| Feature | Seen in | Status | Priority | Effort |
|---|---|---|---|---|
| Search inside images and attachments (OCR) | Notion | Missing | P3 | L |
| Saved searches and operators | Obsidian, Todoist | Partial | P2 | M |
| Semantic search | Notion AI | Partial (keyword retrieval for the AI Hub) | P2 | L |

## Plan my day: audit and phased plan

### What exists today (audited in `client/src/soft/SoftPlan.jsx`)

Pick list from the backlog (overdue first, then priority), drag or tap to place a task in a gap between meetings, Auto-fit, remove from the day, per-task estimates (30 min default), free-versus-needed line, a "now" line, an approval inbox for tasks proposed by Claude or guests, task health (moved three times), calm mode, and a briefing note.

### Gaps and status

| Item | Status now | Priority | Effort |
|---|---|---|---|
| Capacity warning when tasks exceed free time | **Built** (Over by X chip) | P1 | S |
| Breaks between auto-fitted tasks | **Built** (10 minutes) | P1 | S |
| End-of-day carry-over of unfinished work | **Built** (Move N unfinished to tomorrow; counts as a move) | P1 | S |
| Working hours instead of fixed 8:00 to 20:00 | **Built** (Day pickers in the Today panel, remembered per browser) | P1 | S |
| Auto-schedule by deadline and priority across several days | Partial (today only) | P1 | M |
| AI or learned estimates | Missing | P1 | M |
| Calendar events overlay (feeds, Google), not only tasks with times | Partial | P1 | M |
| Focus timer link from a planned block | **Built** (timer icon on each planned block) | P2 | S |
| Full end-of-day review (done, carried, recap note) | Missing (carry-over only) | P2 | M |
| Plan tomorrow / week view | Missing | P2 | M |
| Routines and day templates | Missing | P2 | M |
| Resize a block by dragging its edge | **Built** (grip on the bottom edge, snaps to 15 min, stops at the next meeting, estimate follows) | P2 | S |
| AI plan suggestions | Missing | P2 | M |
| Auto-reschedule when a meeting moves | Missing | P3 | L |

### Phases

1. Done: capacity warning, breaks, carry-over (tests in `e2e/plan-extras.mjs`).
2. Done: working-hours setting, block resize, focus-timer link (tests in `e2e/plan-hours-resize.mjs`). Still small: estimate prompt.
3. Then, medium: calendar-events overlay, multi-day auto-schedule, end-of-day review with recap note, plan-tomorrow view.
4. Later: routines and templates, AI estimates and suggestions, auto-reschedule.

## Still open

- Team mode was exercised through the server suite and the new browser tests; a broad manual walk of every team-mode screen was not done in this run.
- Screenshots from the new tests are written to `D:\Peblo\_shots`; they were not visually inspected.
